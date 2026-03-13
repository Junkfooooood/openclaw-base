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

## Recommended path

1. `shared/runtime/wechat/install_wechat_plugin.sh`
2. `shared/runtime/wechat/start_wechat_stack.sh`
3. `shared/runtime/wechat/generate_wechat_token.sh`
4. `shared/runtime/wechat/configure_wechat_channel.sh --token <TOKEN_KEY>`
5. `shared/runtime/wechat/latest_wechat_qr.sh`
6. Scan the current QR URL with WeChat

## Current defaults

- API URL: `http://127.0.0.1:8848`
- Trigger prefix: `@ai`
- Reply prefix: `[AI] `
- DM policy: `pairing`
- Group policy: `disabled`

## Risk note

This uses an unofficial WeChat iPad protocol bridge (`WeChatPadPro`).
Use a dedicated secondary WeChat account for the bot, not your primary account.
