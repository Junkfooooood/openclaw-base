#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage:
  configure_wechat_channel.sh --token <TOKEN_KEY> [--server-url http://127.0.0.1:8848] [--trigger-prefix @ai]

Options:
  --token           WeChatPadPro TOKEN_KEY
  --server-url      WeChatPadPro API base URL
  --trigger-prefix  Only messages starting with this prefix trigger the bot
  --reply-prefix    Prefix added to outbound replies
  --dm-policy       pairing | allowlist | open | disabled
  --group-policy    allowlist | open | disabled
EOF
}

TOKEN=""
SERVER_URL="http://127.0.0.1:8848"
TRIGGER_PREFIX="@ai"
REPLY_PREFIX="[AI] "
DM_POLICY="pairing"
GROUP_POLICY="disabled"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --server-url)
      SERVER_URL="${2:-}"
      shift 2
      ;;
    --trigger-prefix)
      TRIGGER_PREFIX="${2:-}"
      shift 2
      ;;
    --reply-prefix)
      REPLY_PREFIX="${2:-}"
      shift 2
      ;;
    --dm-policy)
      DM_POLICY="${2:-}"
      shift 2
      ;;
    --group-policy)
      GROUP_POLICY="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "--token is required" >&2
  exit 1
fi

openclaw config set channels.wechat.enabled true
openclaw config set channels.wechat.serverUrl "$SERVER_URL"
openclaw config set channels.wechat.token "$TOKEN"
openclaw config set channels.wechat.triggerPrefix "$TRIGGER_PREFIX"
openclaw config set channels.wechat.replyPrefix "$REPLY_PREFIX"
openclaw config set channels.wechat.dmPolicy "$DM_POLICY"
openclaw config set channels.wechat.groupPolicy "$GROUP_POLICY"
openclaw config set channels.wechat.requireMention true
openclaw config set session.dmScope per-peer
openclaw gateway restart

echo "Configured OpenClaw WeChat channel."
echo "Server: $SERVER_URL"
echo "DM policy: $DM_POLICY"
echo "Group policy: $GROUP_POLICY"
echo
echo "Next: check logs for QR login and scan with WeChat."
