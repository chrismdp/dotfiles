#!/bin/bash

set -euo pipefail

LOG=~/bin/vault-sync.log
cd /home/cp/code/vault || { echo "ERROR: cd failed $(date '+%H:%M')" > "$LOG"; exit 1; }

# Stage all changes
git add -A

# Commit if changes
COMMITTED=""
if ! git diff --cached --quiet; then
    git commit -m "vault backup: $(date '+%Y-%m-%d %H:%M:%S')" >/dev/null 2>&1
    COMMITTED=" committed,"
fi

# Stage any changes that appeared during commit
git add -A

# Pull with rebase
if ! ERR=$(git pull --rebase origin main 2>&1); then
    echo "ERROR: rebase - ${ERR%%$'\n'*} $(date '+%H:%M')" > "$LOG"
    exit 1
fi

# Push (retry with pull --rebase if fails, in case remote changed)
if ! ERR=$(git push origin main 2>&1); then
    # Remote may have changed - pull rebase and try again
    if ! ERR=$(git pull --rebase origin main 2>&1); then
        echo "ERROR: rebase retry - ${ERR%%$'\n'*} $(date '+%H:%M')" > "$LOG"
        exit 1
    fi
    if ! ERR=$(git push origin main 2>&1); then
        echo "ERROR: push retry - ${ERR%%$'\n'*} $(date '+%H:%M')" > "$LOG"
        exit 1
    fi
fi

echo "vault:${COMMITTED} synced $(date '+%H:%M')" > "$LOG"
