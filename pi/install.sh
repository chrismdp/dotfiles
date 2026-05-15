#!/usr/bin/env bash
# Install pi config symlinks from dotfiles/pi/ → ~/.pi/agent/
# Idempotent — safe to run multiple times.

set -euo pipefail

DOTFILES_PI="$(cd "$(dirname "$0")" && pwd)"
PI_AGENT="${HOME}/.pi/agent"

echo "==> Linking pi config from ${DOTFILES_PI} → ${PI_AGENT}"

# Ensure target directories exist
mkdir -p "${PI_AGENT}/extensions"
mkdir -p "${PI_AGENT}/agents"

# ---- settings.json ----
if [ -L "${PI_AGENT}/settings.json" ] || [ -f "${PI_AGENT}/settings.json" ]; then
    rm -f "${PI_AGENT}/settings.json"
fi
ln -s "${DOTFILES_PI}/settings.json" "${PI_AGENT}/settings.json"
echo "  ✓ settings.json"

# ---- models.json ----
if [ -L "${PI_AGENT}/models.json" ] || [ -f "${PI_AGENT}/models.json" ]; then
    rm -f "${PI_AGENT}/models.json"
fi
ln -s "${DOTFILES_PI}/models.json" "${PI_AGENT}/models.json"
echo "  ✓ models.json"

# ---- agents/task.md ----
if [ -L "${PI_AGENT}/agents/task.md" ] || [ -f "${PI_AGENT}/agents/task.md" ]; then
    rm -f "${PI_AGENT}/agents/task.md"
fi
ln -s "${DOTFILES_PI}/agents/task.md" "${PI_AGENT}/agents/task.md"
echo "  ✓ agents/task.md"

# ---- extensions/*.ts ----
for ext in protected-paths claude-rules bash-guard; do
    target="${PI_AGENT}/extensions/${ext}.ts"
    if [ -L "${target}" ] || [ -f "${target}" ]; then
        rm -f "${target}"
    fi
    ln -s "${DOTFILES_PI}/extensions/${ext}.ts" "${target}"
    echo "  ✓ extensions/${ext}.ts"
done

echo ""
echo "Done. All pi config linked."
echo "Note: auth.json is NOT managed here — it lives only at ${PI_AGENT}/auth.json"
