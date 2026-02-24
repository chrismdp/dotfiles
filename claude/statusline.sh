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

# Cross-platform date conversion (macOS uses -j -f, Linux uses -d)
iso_to_epoch() {
    local iso="$1"
    if [ "$(uname)" = "Darwin" ]; then
        # Strip fractional seconds and Z, then parse
        local clean=$(echo "$iso" | sed 's/\.[0-9]*Z$/Z/' | sed 's/Z$/+0000/')
        date -j -f "%Y-%m-%dT%H:%M:%S%z" "$clean" "+%s" 2>/dev/null
    else
        date -d "$iso" "+%s" 2>/dev/null
    fi
}

epoch_to_fmt() {
    local epoch="$1"
    local fmt="$2"
    if [ "$(uname)" = "Darwin" ]; then
        date -r "$epoch" "+$fmt" 2>/dev/null
    else
        date -d "@$epoch" "+$fmt" 2>/dev/null
    fi
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

# Check for in-progress bead
bead_id=""
bead_title=""
bead_line=$(bd list --status in_progress --limit 1 2>/dev/null | head -1)
if [ -n "$bead_line" ]; then
    bead_id=$(echo "$bead_line" | grep -oE '[a-z]+-[a-z0-9]+' | head -1)
    bead_title=$(echo "$bead_line" | sed 's/^.*- //')
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

# Fetch API usage data - credentials stored differently per platform
token=""
if [ "$(uname)" = "Darwin" ]; then
    creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
    if [ -n "$creds" ]; then
        token=$(echo "$creds" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
    fi
else
    token=$(jq -r '.claudeAiOauth.accessToken // empty' ~/.claude/.credentials.json 2>/dev/null)
fi

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
            epoch=$(iso_to_epoch "$five_hour_reset")
            if [ -n "$epoch" ]; then
                remainder=$((epoch % 300))
                if [ "$remainder" -ne 0 ]; then
                    epoch=$((epoch + 300 - remainder))
                fi
                reset_formatted=$(epoch_to_fmt "$epoch" "%H:%M")
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
            epoch=$(iso_to_epoch "$weekly_reset")
            if [ -n "$epoch" ]; then
                remainder=$((epoch % 300))
                if [ "$remainder" -ne 0 ]; then
                    epoch=$((epoch + 300 - remainder))
                fi
                day_name=$(epoch_to_fmt "$epoch" "%a %H:%M")
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

# Vault sync and heartbeat status (only show if log files exist)
sync_section=""
if [ -f ~/bin/vault-sync.log ]; then
    vault_sync_raw=$(cat ~/bin/vault-sync.log)
    sync_time=$(echo "$vault_sync_raw" | grep -oE '[0-9]{2}:[0-9]{2}' | tail -1)
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
    sync_section="${vault_sym}"
fi

if [ -f /tmp/heartbeat-last-run ]; then
    hb_last=$(cat /tmp/heartbeat-last-run)
    sync_section="${sync_section} ♡${hb_last}"
    hb_stale_time=$(tail -1 /tmp/heartbeat-stale-kills.log 2>/dev/null | grep -oE '^[0-9]{2}:[0-9]{2}')
    hb_err=$(cat /tmp/heartbeat.log 2>/dev/null)
    if [ -n "$hb_stale_time" ]; then
        sync_section="${sync_section} ${YELLOW}⚠${hb_stale_time}${RESET}"
    elif [ -n "$hb_err" ]; then
        sync_section="${sync_section} ${RED}✗${RESET}"
    fi
fi

# Build final output
if [ -n "$bead_id" ]; then
    name_display="${YELLOW}${bead_id}${RESET}"
else
    name_display="${CYAN}${workspace_name}${RESET}"
fi

if [ -n "$sync_section" ]; then
    echo -e "${name_display} ${DIM}|${RESET} ${ctx_display}${usage_section} ${DIM}|${RESET} ${sync_section}"
else
    echo -e "${name_display} ${DIM}|${RESET} ${ctx_display}${usage_section}"
fi
