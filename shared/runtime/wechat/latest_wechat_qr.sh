#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOME}/.openclaw"
LOG_FILE="${ROOT}/logs/gateway.log"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "Gateway log not found: $LOG_FILE" >&2
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  url="$(rg 'QR URL:' "$LOG_FILE" | tail -n 1 | sed 's/.*QR URL: //')"
else
  url="$(grep 'QR URL:' "$LOG_FILE" | tail -n 1 | sed 's/.*QR URL: //')"
fi

if [[ -z "$url" ]]; then
  echo "No WeChat QR URL found in gateway.log yet." >&2
  exit 1
fi

echo "$url"
