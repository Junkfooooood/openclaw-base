#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

ensure_env_file
load_env_file
compose_cmd up -d --force-recreate

cat <<EOF
WeChatPadPro stack is starting.
- API:    http://127.0.0.1:${WECHAT_API_PORT}
- Worker: http://127.0.0.1:${WECHAT_WORKER_PORT}
- Admin key saved in: ${ENV_FILE}

Next:
1. Run generate_wechat_token.sh
2. Run configure_wechat_channel.sh --token <TOKEN_KEY>
3. Restart gateway and scan the QR code from logs or terminal
EOF
