#!/bin/bash

set -uo pipefail  # Remove -e, handle errors explicitly

LOG=~/bin/vault-sync.log
LOCK=~/bin/vault-sync.lock
VAULT=~/vault
MAX_RETRIES=5

log() { echo "$1 $(date '+%H:%M')" > "$LOG"; }

cleanup() {
    # Abort any in-progress rebase
    git -C "$VAULT" rebase --abort 2>/dev/null || true
    rm -f "$LOCK"
}

# Acquire lock (skip if already running)
exec 9>"$LOCK"
if ! flock -n 9; then
    log "vault: skipped (already running)"
    exit 0
fi
trap cleanup EXIT

cd "$VAULT" || { log "ERROR: cd failed"; exit 1; }

sync_once() {
    # Stage and commit
    git add -A
    local committed=""
    if ! git diff --cached --quiet; then
        git commit -q -m "vault backup: $(date '+%Y-%m-%d %H:%M:%S')"
        committed=" committed,"
    fi

    # Record HEAD before pull
    local head_before
    head_before=$(git rev-parse HEAD)

    # Pull with rebase
    if ! git pull --rebase origin main -q; then
        git rebase --abort 2>/dev/null || true
        return 1
    fi

    local head_after
    head_after=$(git rev-parse HEAD)

    # Process new or changed transcripts that arrived via pull
    if [[ "$head_before" != "$head_after" ]]; then
        local changed_transcripts
        changed_transcripts=$(git diff --name-only --diff-filter=AM "$head_before" "$head_after" -- transcripts/)
        if [[ -n "$changed_transcripts" ]]; then
            while IFS= read -r transcript; do
                # Generate diff for modified files (empty for brand new files)
                local diff_file
                diff_file=$(mktemp /tmp/transcript-diff-XXXXXX.txt)
                git diff "$head_before" "$head_after" -- "$transcript" > "$diff_file" 2>/dev/null || true
                nohup /home/cp/.claude/skills/heartbeat/scripts/process-transcript.sh "$VAULT/$transcript" "$diff_file" &
            done <<< "$changed_transcripts"
        fi
    fi

    # Push
    git push origin main -q || return 1

    echo "$committed"
    return 0
}

# Retry loop with exponential backoff
for attempt in $(seq 1 $MAX_RETRIES); do
    if committed=$(sync_once 2>&1); then
        if [[ $attempt -gt 1 ]]; then
            log "vault:${committed} synced (retried $((attempt-1))x)"
        else
            log "vault:${committed} synced"
        fi

        exit 0
    fi

    if [[ $attempt -lt $MAX_RETRIES ]]; then
        sleep $((2 ** attempt))  # 2s, 4s, 8s, 16s backoff
    fi
done

log "ERROR: failed after $MAX_RETRIES attempts"
exit 1
