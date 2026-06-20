#!/bin/bash
# ============================================================
# OCO Pool Runner — warm server pool with TUI dashboard
# ============================================================
# Copy to run-pool.sh and fill in your values.
#
# Usage:
#   ~/dev/oco/run-pool.sh              # 4 servers (default)
#   ~/dev/oco/run-pool.sh --pool 6     # 6 servers
#   ~/dev/oco/run-pool.sh --pool 2     # 2 servers

export OCO_URL="https://oco.yourdomain.com"
export OCO_API_TOKEN="your_oco_api_token"
export OCO_ACCESS_CLIENT_ID="your_access_client_id.access"
export OCO_ACCESS_CLIENT_SECRET="your_access_client_secret"

exec node ~/dev/oco/runner-pool.mjs "$@"
