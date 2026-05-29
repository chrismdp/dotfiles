#!/usr/bin/env bash
# Launch vault-inbox with the bearer token resolved from 1Password at runtime,
# so the secret never lives in a plaintext env file. Used as the service
# ExecStart (see vault-inbox.service). op:// references stay in this private
# dotfiles repo, not the public vault-inbox repo.
set -eo pipefail
cd /home/cp/code/vault-inbox
set +u; source /home/cp/.secret_env 2>/dev/null || true   # provides OP_SERVICE_ACCOUNT_TOKEN
set -u
TOKEN="$(/usr/bin/op read 'op://Kim/vault-inbox/password' 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "vault-inbox: could not read op://Kim/vault-inbox/password (is OP_SERVICE_ACCOUNT_TOKEN set?)" >&2
  exit 1
fi
export VAULT_INBOX_BEARER_TOKEN="$TOKEN"
exec /home/cp/.local/bin/uv run --no-sync uvicorn main:app --host 127.0.0.1 --port 8790
