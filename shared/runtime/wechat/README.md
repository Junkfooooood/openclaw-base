# WeChat Channel Runtime

This folder contains the local runtime helpers for OpenClaw's WeChat channel.

## What this stack does

1. Starts a local `WeChatPadPro` service with `MySQL + Redis`
2. Generates a `TOKEN_KEY`
3. Writes the required `channels.wechat.*` config into OpenClaw
4. Restarts the OpenClaw gateway so the plugin can show a login QR code

## Files

- `docker-compose.yml`
  - Local WeChatPadPro stack
- `install_wechat_plugin.sh`
  - Install the pinned OpenClaw WeChat plugin version
- `.env.example`
  - Template for the local secrets file
- `start_wechat_stack.sh`
  - Start MySQL, Redis, and WeChatPadPro
- `generate_wechat_token.sh`
  - Generate a TOKEN_KEY from the local ADMIN_KEY
- `configure_wechat_channel.sh`
  - Write OpenClaw's `channels.wechat` config and restart the gateway
- `latest_wechat_qr.sh`
  - Print the latest WeChat login QR URL from `logs/gateway.log`
- `wechat_watchdog.mjs`
  - Check WeChat login health and auto-heal clear disconnects
- `install_wechat_watchdog.sh`
  - Install a macOS LaunchAgent that runs the watchdog every 5 minutes

## Recommended path

1. `shared/runtime/wechat/install_wechat_plugin.sh`
2. `shared/runtime/wechat/start_wechat_stack.sh`
3. `shared/runtime/wechat/generate_wechat_token.sh`
4. `shared/runtime/wechat/configure_wechat_channel.sh --token <TOKEN_KEY>`
5. `shared/runtime/wechat/latest_wechat_qr.sh`
6. Scan the current QR URL with WeChat

## Auto-recovery

The local watchdog can handle the common "clear disconnect" path:

1. Check `GET /login/GetLoginStatus`
2. If the bridge is offline or unreachable:
   - restart the OpenClaw gateway
   - restart the WeChat stack
   - restart the gateway again
3. If the account still needs manual login, write the latest QR URL to:
   - `shared/runtime/wechat/state/latest-recovery-qr.txt`
   - `shared/runtime/wechat/state/watchdog-status.json`

Useful commands:

- One-off status check:
  - `node /Users/linqingxuan/.openclaw/shared/runtime/wechat/wechat_watchdog.mjs status`
- One-off self-heal:
  - `node /Users/linqingxuan/.openclaw/shared/runtime/wechat/wechat_watchdog.mjs heal`
- Force a full recovery pass:
  - `node /Users/linqingxuan/.openclaw/shared/runtime/wechat/wechat_watchdog.mjs heal --force`
- Install the background watchdog:
  - `bash /Users/linqingxuan/.openclaw/shared/runtime/wechat/install_wechat_watchdog.sh`

## Current defaults

- API URL: `http://127.0.0.1:8848`
- Trigger prefix: `@ai`
- Reply prefix: `[AI] `
- DM policy: `pairing`
- Group policy: `disabled`

## Risk note

This uses an unofficial WeChat iPad protocol bridge (`WeChatPadPro`).
Use a dedicated secondary WeChat account for the bot, not your primary account.
