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

# Chris's inputs and mail sessions edit and commit the vault under this lock, and record each
# commit for Undo. A backup mid-session sweeps their changes into its own commit, so wait.
exec 8>/home/cp/.local/state/w1-process.lock
if ! flock -n 8; then
    log "vault: skipped (an inputs or mail session is running)"
    exit 0
fi

cd "$VAULT" || { log "ERROR: cd failed"; exit 1; }

# Fold Syncthing conflict copies back into their notes before anything is staged.
# Once per run, not per retry: a retry only redoes the pull and push. Its own log,
# because $LOG keeps one line. A resolver failure must never stop the backup.
"$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/sync-conflict-merge" "$VAULT" \
    >> ~/bin/sync-conflict-merge.log 2>&1 || true

sync_once() {
    # Stage and commit
    git add -A
    local committed=""
    if ! git diff --cached --quiet; then
        git commit -q -m "vault backup: $(date '+%Y-%m-%d %H:%M:%S')"
        committed=" committed,"
    fi

    # Pull with rebase
    if ! git pull --rebase origin main -q; then
        git rebase --abort 2>/dev/null || true
        return 1
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

        # Check for new transcripts after sync completes
        ~/bin/process-new-transcripts.sh &

        exit 0
    fi

    if [[ $attempt -lt $MAX_RETRIES ]]; then
        sleep $((2 ** attempt))  # 2s, 4s, 8s, 16s backoff
    fi
done

log "ERROR: failed after $MAX_RETRIES attempts"
exit 1
