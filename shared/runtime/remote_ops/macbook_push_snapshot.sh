#!/bin/zsh
set -euo pipefail

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
REMOTE_HOST="${OPENCLAW_REMOTE_HOST:-linqingxuandeMac-mini.local}"
REMOTE_USER="${OPENCLAW_REMOTE_USER:-linqingxuan}"
REMOTE_ROOT="${OPENCLAW_REMOTE_ROOT:-~/.openclaw}"
LOCAL_DEVICE_ID="${OPENCLAW_LOCAL_DEVICE_ID:-macbook}"
REMOTE_DEVICE_ID="${OPENCLAW_REMOTE_DEVICE_ID:-$LOCAL_DEVICE_ID}"
REMOTE_STAGE_DIR="${OPENCLAW_REMOTE_STAGE_DIR:-/tmp/openclaw-remote-ops}"
REMOTE_STAGE_FILE="${REMOTE_STAGE_DIR}/${REMOTE_DEVICE_ID}-latest.json"

json="$(
  node "$OPENCLAW_ROOT/shared/workflows/bin/remote_ops_workflow.mjs" \
    build-device-snapshot \
    --device-id "$LOCAL_DEVICE_ID" \
    --json
)"

snapshot_path="$(printf '%s' "$json" | jq -r '.snapshot_path')"

echo "Uploading ${snapshot_path} -> ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_STAGE_FILE}"
ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p '${REMOTE_STAGE_DIR}'"
scp "$snapshot_path" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_STAGE_FILE}"
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "node '${REMOTE_ROOT}/shared/workflows/bin/remote_ops_workflow.mjs' ingest-snapshot --device-id '${REMOTE_DEVICE_ID}' --file '${REMOTE_STAGE_FILE}' --json >/dev/null && node '${REMOTE_ROOT}/shared/workflows/bin/remote_ops_workflow.mjs' aggregate --device-id macmini --json >/dev/null"

echo "Remote snapshot ingested as ${REMOTE_DEVICE_ID} and dashboard exports refreshed."

