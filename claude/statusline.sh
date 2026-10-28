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

# Extract session name (prefer over workspace name when set)
session_name=$(echo "$input" | jq -r '.session_name // empty')

# Extract workspace name
project_dir=$(echo "$input" | jq -r '.workspace.project_dir // empty')
if [ -n "$project_dir" ]; then
    workspace_name=$(basename "$project_dir")
else
    workspace_name="Claude"
fi

# Use session name if set, otherwise fall back to workspace name
if [ -n "$session_name" ]; then
    display_name="$session_name"
else
    display_name="$workspace_name"
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
# Scale to 90% of actual capacity (compression triggers at ~90%, so 90% real = 100% displayed)
if [ -n "$used" ]; then
    raw_pct=$(printf "%.0f" "$used")
    ctx_pct=$(( raw_pct * 100 / 90 ))
    if [ "$ctx_pct" -gt 100 ]; then ctx_pct=100; fi
    ctx_bar=$(progress_bar "$ctx_pct")
    ctx_colour=$(get_colour "$ctx_pct" 40 65)
    ctx_display="◧ ${ctx_pct}% ${ctx_colour}${ctx_bar}${RESET}"
else
    ctx_display="◧ N/A"
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

# Transcript sync status (show errors if recent)
if [ -f ~/bin/sync-drive-transcripts.log ]; then
    last_transcript_line=$(tail -1 ~/bin/sync-drive-transcripts.log)
    if echo "$last_transcript_line" | grep -q 'ERROR'; then
        # Count consecutive recent errors
        err_count=$(tac ~/bin/sync-drive-transcripts.log | grep -c '^.*ERROR' | head -1)
        consecutive_errs=$(tac ~/bin/sync-drive-transcripts.log | while IFS= read -r line; do
            if echo "$line" | grep -q 'ERROR'; then echo x; else break; fi
        done | wc -l)
        if [ "$consecutive_errs" -ge 3 ]; then
            sync_section="${sync_section} ${RED}☰${consecutive_errs}✗${RESET}"
        fi
    fi
fi

if [ -f /tmp/heartbeat-last-run ]; then
    hb_last=$(cat /tmp/heartbeat-last-run)
    sync_section="${sync_section} ♡${hb_last}"
    hb_stale_time=$(tail -1 /tmp/heartbeat-stale-kills.log 2>/dev/null | grep -oE '^[0-9]{2}:[0-9]{2}')
    hb_err=$(cat /tmp/heartbeat.log 2>/dev/null)
    if [ -n "$hb_stale_time" ]; then
        sync_section="${sync_section} ${YELLOW}⚠${hb_stale_time}${RESET}"
    elif [ -n "$hb_err" ]; then
        hb_err_short=$(echo "$hb_err" | tail -1 | cut -c1-40)
        sync_section="${sync_section} ${RED}✗${hb_err_short}${RESET}"
    fi
fi

# /ralph ticket counts. Look in the workspace dir for one of the four
# ticket folder conventions (docs/tickets, docs/changes, doc/changes,
# doc/tickets). If none exists at the top level, look one level down —
# if exactly one immediate subdir has a ticket folder, use it. Mirrors
# the bundled ralph.sh runner's descent rule.
find_ticket_dir() {
    local base="$1"
    for sub in docs/tickets docs/changes doc/changes doc/tickets; do
        if [ -d "$base/$sub" ]; then
            echo "$base/$sub"
            return 0
        fi
    done
    return 1
}

ticket_section=""
if [ -n "$project_dir" ]; then
    ticket_dir=$(find_ticket_dir "$project_dir")
    if [ -z "$ticket_dir" ]; then
        candidates=()
        for child in "$project_dir"/*/; do
            [ -d "$child" ] || continue
            found=$(find_ticket_dir "${child%/}")
            [ -n "$found" ] && candidates+=("$found")
        done
        if [ "${#candidates[@]}" -eq 1 ]; then
            ticket_dir="${candidates[0]}"
        fi
    fi
    if [ -n "$ticket_dir" ] && [ -d "$ticket_dir" ]; then
        todo_count=$(grep -lE "^status: (todo|draft|pending)" "$ticket_dir"/*.md 2>/dev/null | wc -l)
        doing_count=$(grep -lE "^status: (doing|in-progress)" "$ticket_dir"/*.md 2>/dev/null | wc -l)
        qa_count=$(grep -lE "^status: qa" "$ticket_dir"/*.md 2>/dev/null | wc -l)
        if [ "$todo_count" -gt 0 ] || [ "$doing_count" -gt 0 ] || [ "$qa_count" -gt 0 ]; then
            parts=()
            [ "$doing_count" -gt 0 ] && parts+=("${doing_count} doing")
            [ "$todo_count" -gt 0 ] && parts+=("${todo_count} todo")
            [ "$qa_count" -gt 0 ] && parts+=("${qa_count} qa")
            joined=$(IFS=' · '; echo "${parts[*]}")
            ticket_section=" ${DIM}|${RESET} ⎘ ${joined}"
        fi
    fi
fi

# Build final output
if [ -n "$bead_id" ]; then
    name_display="${YELLOW}${bead_id}${RESET}"
else
    name_display="${CYAN}${display_name}${RESET}"
fi

if [ -n "$sync_section" ]; then
    echo -e "${name_display} ${DIM}|${RESET} ${ctx_display} ${DIM}|${RESET} ${sync_section}${ticket_section}"
else
    echo -e "${name_display} ${DIM}|${RESET} ${ctx_display}${ticket_section}"
fi
