# Remote Ops

This directory holds the execution layer for step 13 / step 14:

- MacBook usage snapshot collection
- Mac mini aggregation of remote device snapshots
- OpenClaw agent workflow visualization
- Learning-board markdown/calendar exports
- Dashboard tunnel + notification helpers

## Main entrypoint

```bash
node shared/workflows/bin/remote_ops_workflow.mjs aggregate --device-id macmini --json
```

## Suggested flow

1. On the MacBook:
   - `sample-apps`
   - `build-device-snapshot`
   - push the generated JSON from `shared/runtime/remote_ops/outbox/macbook/` to the Mac mini inbox

2. On the Mac mini:
   - `ingest-snapshot --file <snapshot.json>`
   - `aggregate`
   - `sync-obsidian` (optional, writes to the Obsidian/iCloud draft folder)

3. For dashboard access from the MacBook:
   - use `macbook_dashboard_tunnel.sh --open`
   - then open the tunnel URL exported into `shared/runtime/remote_ops/export/dashboard-access.md`

4. For a full MacBook -> Mac mini refresh:
   - use `macbook_push_snapshot.sh`
   - it builds the local snapshot, uploads it, ingests it on the Mac mini, and refreshes dashboard exports

## Fastest reconnect

```bash
OPENCLAW_DASHBOARD_TOKEN='<token>' \
OPENCLAW_REMOTE_HOST='linqingxuandeMac-mini.local' \
OPENCLAW_REMOTE_USER='linqingxuan' \
zsh shared/runtime/remote_ops/macbook_dashboard_tunnel.sh --open
```

## Exports

Generated files live under `shared/runtime/remote_ops/export/`:

- `workflow-summary.json`
- `workflow-summary.md`
- `workflow-dashboard.html`
- `learning-board.md`
- `dashboard-access.md`
- `learning-calendar.ics`
