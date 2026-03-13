#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SOURCE="$SCRIPT_DIR/ai.openclaw.wechat-watchdog.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/ai.openclaw.wechat-watchdog.plist"
STATE_DIR="$SCRIPT_DIR/state"

mkdir -p "$STATE_DIR" "$HOME/Library/LaunchAgents"
install -m 644 "$PLIST_SOURCE" "$PLIST_TARGET"

launchctl bootout "gui/$(id -u)" "$PLIST_TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"
launchctl kickstart -k "gui/$(id -u)/ai.openclaw.wechat-watchdog"

cat <<EOF
Installed ai.openclaw.wechat-watchdog
- plist: $PLIST_TARGET
- status: $STATE_DIR/watchdog-status.json
- qr: $STATE_DIR/latest-recovery-qr.txt
- stdout: $STATE_DIR/watchdog.stdout.log
- stderr: $STATE_DIR/watchdog.stderr.log
EOF
