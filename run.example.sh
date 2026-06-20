#!/bin/bash
# ============================================================
# OCO Runner wrapper — sets auth credentials and starts runner
# ============================================================
# Copy this to run.sh and fill in your values.
# run.sh is in .gitignore — it will not be committed.
#
# Usage:
#   ~/dev/oco/run.sh                  # sequential (1 task at a time)
#   ~/dev/oco/run.sh --parallel 4     # 4 tasks concurrently
#   ~/dev/oco/run.sh --dry-run        # preview without executing
#   ~/dev/oco/run.sh --once           # execute one task and exit

export OCO_URL="https://oco.yourdomain.com"
export OCO_API_TOKEN="your_oco_api_token"
export OCO_ACCESS_CLIENT_ID="your_access_client_id.access"
export OCO_ACCESS_CLIENT_SECRET="your_access_client_secret"

# Verify DNS resolution before starting
if ! dig +short "$(echo $OCO_URL | sed 's|https://||')" A | grep -q .; then
  echo "[OCO] ERROR: Cannot resolve $(echo $OCO_URL | sed 's|https://||')"
  echo "[OCO] Check your DNS configuration"
  exit 1
fi

exec node ~/dev/oco/runner.mjs "$@"
