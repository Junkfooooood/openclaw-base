# Dashboard Access

Generated: 2026-03-13T03:48:03.101Z

- Local Mac mini dashboard: http://127.0.0.1:18789/#token=6c07ffdb5497a6975efd0794267d0eeae23be2fc1f80fa9f
- MacBook tunnel URL: http://127.0.0.1:18790/#token=6c07ffdb5497a6975efd0794267d0eeae23be2fc1f80fa9f

## Tunnel Command
`ssh -N -L 18790:127.0.0.1:18789 linqingxuan@linqingxuandeMac-mini.local`

## Notes
- Keep the gateway token private.
- This SSH tunnel keeps the gateway loopback-only on the Mac mini.
- If you later move to Tailscale, update shared/runtime/remote_ops/config.json instead of exposing the gateway directly.
