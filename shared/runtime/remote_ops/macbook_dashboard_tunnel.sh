#!/bin/zsh
set -euo pipefail

REMOTE_HOST="${OPENCLAW_REMOTE_HOST:-linqingxuandeMac-mini.local}"
REMOTE_USER="${OPENCLAW_REMOTE_USER:-linqingxuan}"
LOCAL_PORT="${OPENCLAW_DASHBOARD_LOCAL_PORT:-18790}"
REMOTE_PORT="${OPENCLAW_DASHBOARD_REMOTE_PORT:-18789}"
DASHBOARD_TOKEN="${OPENCLAW_DASHBOARD_TOKEN:-}"
MODE="${1:-foreground}"

dashboard_url="http://127.0.0.1:${LOCAL_PORT}/"
if [[ -n "${DASHBOARD_TOKEN}" ]]; then
  dashboard_url="${dashboard_url}#token=${DASHBOARD_TOKEN}"
fi

echo "Opening SSH tunnel to ${REMOTE_USER}@${REMOTE_HOST}"
echo "Dashboard URL: ${dashboard_url}"

if [[ "${MODE}" == "background" || "${MODE}" == "--background" || "${MODE}" == "--open" ]]; then
  ssh -fN -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" "${REMOTE_USER}@${REMOTE_HOST}"
  echo "Tunnel started in background."
  if [[ "${MODE}" == "--open" ]] && command -v open >/dev/null 2>&1; then
    open "${dashboard_url}"
  fi
  exit 0
fi

exec ssh -N -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" "${REMOTE_USER}@${REMOTE_HOST}"
