#!/usr/bin/env node

import path from "node:path";
import {
  aggregateRemoteOps,
  buildDeviceSnapshot,
  composeNotification,
  findProjectRoot,
  ingestSnapshot,
  loadRemoteOpsConfig,
  sampleApps,
  sendNotification,
  syncExportsToObsidian
} from "../../runtime/remote_ops/remote_ops_lib.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        index += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function printHelp() {
  console.log(`Usage: node shared/workflows/bin/remote_ops_workflow.mjs <command> [options]

Commands:
  sample-apps                Capture one app usage sample into shared/runtime/remote_ops/state/<device>.
  build-device-snapshot      Build one device snapshot from browser/chatlog/app signals.
  ingest-snapshot            Copy a remote snapshot JSON into shared/runtime/remote_ops/inbox/<device>.
  aggregate                  Build workflow + learning exports under shared/runtime/remote_ops/export.
  compose-notification       Print the current remote-ops notification summary.
  send-notification          Send or dry-run a notification with openclaw message send.
  sync-obsidian              Copy generated exports into the configured Obsidian draft folder.

Options:
  --device-id <id>           Device id, default: current hostname.
  --file <path>              Snapshot file path for ingest-snapshot.
  --target <dest>            Override notification target.
  --channel <name>           Override notification channel.
  --dry-run                  Do not send external notification.
  --json                     Print machine-readable JSON.
`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command || flags.help || flags.h) {
    printHelp();
    process.exit(command ? 0 : 1);
  }

  const root = findProjectRoot();
  const config = await loadRemoteOpsConfig(root);
  const deviceId =
    String(flags["device-id"] ?? config.deviceId ?? path.basename(root)).replace(/\s+/g, "-");
  let output;

  if (command === "sample-apps") {
    output = await sampleApps(root, deviceId);
  } else if (command === "build-device-snapshot") {
    output = await buildDeviceSnapshot(root, deviceId, config);
  } else if (command === "ingest-snapshot") {
    if (!flags.file) {
      throw new Error("ingest-snapshot requires --file <path>.");
    }
    output = await ingestSnapshot(root, path.resolve(String(flags.file)), flags["device-id"] ?? null);
  } else if (command === "aggregate") {
    output = await aggregateRemoteOps(root, deviceId, config);
  } else if (command === "compose-notification") {
    const aggregate = await aggregateRemoteOps(root, deviceId, config);
    output = composeNotification(aggregate.bundle, config);
  } else if (command === "send-notification") {
    const aggregate = await aggregateRemoteOps(root, deviceId, config);
    output = await sendNotification(root, aggregate.bundle, config, {
      dryRun: Boolean(flags["dry-run"]),
      channel: flags.channel ? String(flags.channel) : null,
      target: flags.target ? String(flags.target) : null
    });
  } else if (command === "sync-obsidian") {
    output = await syncExportsToObsidian(root, config);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  if (flags.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

