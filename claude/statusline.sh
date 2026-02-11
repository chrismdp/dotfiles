#!/bin/bash

# ANSI colour codes
RED='\033[1;31m'
YELLOW='\033[1;33m'
GREEN='\033[1;32m'
CYAN='\033[1;36m'
DIM='\033[2m'
RESET='\033[0m'

# Function to get colour based on percentage and thresholds
get_colour() {
    local pct=$1
    local yellow_threshold=$2
    local red_threshold=$3

    if [ "$pct" -ge "$red_threshold" ]; then
        echo "$RED"
    elif [ "$pct" -ge "$yellow_threshold" ]; then
        echo "$YELLOW"
    else
        echo "$GREEN"
    fi
}

# Build a 5-char progress bar
progress_bar() {
    local pct=$1
    local filled=$((pct / 20))
    if [ "$pct" -gt 0 ] && [ "$filled" -eq 0 ]; then filled=1; fi
    local empty=$((5 - filled))
    local bar=""
    for ((i=0; i<filled; i++)); do bar+="▓"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done
    echo "$bar"
}

# Read JSON input from stdin
input=$(cat)

# Extract workspace name
project_dir=$(echo "$input" | jq -r '.workspace.project_dir // empty')
if [ -n "$project_dir" ]; then
    workspace_name=$(basename "$project_dir")
else
    workspace_name="Claude"
fi

# Extract context window and model info
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')

# Format context usage with progress bar
if [ -n "$used" ]; then
    ctx_pct=$(printf "%.0f" "$used")
    ctx_bar=$(progress_bar "$ctx_pct")
    ctx_colour=$(get_colour "$ctx_pct" 40 65)
    ctx_display="◧ ${ctx_pct}% ${ctx_colour}${ctx_bar}${RESET}"
else
    ctx_display="◧ N/A"
fi

# Fetch API usage data
token=$(jq -r '.claudeAiOauth.accessToken // empty' ~/.claude/.credentials.json 2>/dev/null)

usage_section=""
if [ -n "$token" ]; then
    api_response=$(curl -s --max-time 5 -H "Authorization: Bearer $token" \
                        -H "anthropic-beta: oauth-2025-04-20" \
                        https://api.anthropic.com/api/oauth/usage 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$api_response" ] && ! echo "$api_response" | jq -e '.error' >/dev/null 2>&1; then
        # Parse 5-hour usage data
        five_hour_util=$(echo "$api_response" | jq -r '.five_hour.utilization // empty')
        five_hour_reset=$(echo "$api_response" | jq -r '.five_hour.resets_at // empty')

        if [ -n "$five_hour_util" ] && [ "$five_hour_util" != "null" ]; then
            five_hour_pct=$(printf "%.0f" "$five_hour_util")
            bar=$(progress_bar "$five_hour_pct")
            bar_colour=$(get_colour "$five_hour_pct" 40 70)
            five_hour_display="5h:${five_hour_pct}% ${bar_colour}${bar}${RESET}"
        else
            five_hour_display=""
        fi

        # Format 5-hour reset time
        five_hour_reset_display=""
        if [ -n "$five_hour_reset" ] && [ "$five_hour_reset" != "null" ]; then
            epoch=$(date -d "$five_hour_reset" "+%s" 2>/dev/null)
            if [ -n "$epoch" ]; then
                remainder=$((epoch % 300))
                if [ "$remainder" -ne 0 ]; then
                    epoch=$((epoch + 300 - remainder))
                fi
                reset_formatted=$(date -d "@$epoch" "+%H:%M" 2>/dev/null)
                if [ -n "$reset_formatted" ]; then
                    five_hour_reset_display=" ${DIM}→ ${reset_formatted}${RESET}"
                fi
            fi
        fi

        # Parse 7-day usage data
        weekly_util=$(echo "$api_response" | jq -r '.seven_day.utilization // empty')
        weekly_reset=$(echo "$api_response" | jq -r '.seven_day.resets_at // empty')

        if [ -n "$weekly_util" ] && [ "$weekly_util" != "null" ]; then
            weekly_pct=$(printf "%.0f" "$weekly_util")
            bar=$(progress_bar "$weekly_pct")
            bar_colour=$(get_colour "$weekly_pct" 40 70)
            weekly_display="7d:${weekly_pct}% ${bar_colour}${bar}${RESET}"
        else
            weekly_display=""
        fi

        # Format weekly reset time
        weekly_reset_display=""
        if [ -n "$weekly_reset" ] && [ "$weekly_reset" != "null" ]; then
            epoch=$(date -d "$weekly_reset" "+%s" 2>/dev/null)
            if [ -n "$epoch" ]; then
                remainder=$((epoch % 300))
                if [ "$remainder" -ne 0 ]; then
                    epoch=$((epoch + 300 - remainder))
                fi
                day_name=$(date -d "@$epoch" "+%a %H:%M" 2>/dev/null)
                if [ -n "$day_name" ]; then
                    weekly_reset_display=" ${DIM}→ ${day_name}${RESET}"
                fi
            fi
        fi

        # Build usage section
        if [ -n "$five_hour_display" ] || [ -n "$weekly_display" ]; then
            usage_section=" ${DIM}|${RESET}"
            if [ -n "$five_hour_display" ]; then
                usage_section="${usage_section} ${five_hour_display}${five_hour_reset_display}"
            fi
            if [ -n "$weekly_display" ]; then
                if [ -n "$five_hour_display" ]; then
                    usage_section="${usage_section} ${DIM}·${RESET}"
                fi
                usage_section="${usage_section} ${weekly_display}${weekly_reset_display}"
            fi
        fi
    fi
fi

# Vault sync and heartbeat status
vault_sync_raw=$(cat ~/bin/vault-sync.log 2>/dev/null || echo 'await')
hb_last=$(cat /tmp/heartbeat-last-run 2>/dev/null || echo '?')
hb_err=$(cat /tmp/heartbeat.log 2>/dev/null)
hb_stale_time=$(tail -1 /tmp/heartbeat-stale-kills.log 2>/dev/null | grep -oP '^\d{2}:\d{2}')

# Transform vault sync to unicode: ✓=committed ↑=synced ⏳=awaiting
sync_time=$(echo "$vault_sync_raw" | grep -oP '\d{2}:\d{2}' | tail -1)
if echo "$vault_sync_raw" | grep -q 'committed.*synced'; then
    vault_sym="✓↑${sync_time}"
elif echo "$vault_sync_raw" | grep -q 'committed'; then
    vault_sym="✓"
elif echo "$vault_sync_raw" | grep -q 'synced'; then
    vault_sym="↑${sync_time}"
elif echo "$vault_sync_raw" | grep -q 'await'; then
    vault_sym="⏳"
else
    vault_sym="${vault_sync_raw}"
fi

sync_section="${vault_sym} ♡${hb_last}"
if [ -n "$hb_stale_time" ]; then
    sync_section="${sync_section} ${YELLOW}⚠${hb_stale_time}${RESET}"
elif [ -n "$hb_err" ]; then
    sync_section="${sync_section} ${RED}✗${RESET}"
fi

# Build final output
echo -e "${CYAN}${workspace_name}${RESET} ${DIM}|${RESET} ${ctx_display}${usage_section} ${DIM}|${RESET} ${sync_section}"
