#!/usr/bin/env node

import {
  activateDraft,
  captureEvolutionSignal,
  findProjectRoot,
  ingestReviewSignal,
  runEvolutionLoop,
  aggregateEvolutionSignals,
  createEvolutionDraft,
  shadowTestDraft
} from "../../runtime/sop_evolution/sop_evolution_lib.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { positional, flags };
}

function parseJsonFlag(raw, fallback) {
  if (!raw) return fallback;
  return JSON.parse(String(raw));
}

function printHelp() {
  console.log(`Usage: node shared/workflows/bin/sop_evolution_workflow.mjs <command> [options]

Commands:
  capture-signal           Capture one SOP evolution signal into shared/runtime/sop_evolution/signals.
  ingest-review           Extract one review envelope from a JSON file and store it as a signal.
  aggregate               Aggregate recurring advisories / failed checks for one SOP.
  draft-update            Build one managed runtime-learnings draft from the latest report.
  shadow-test             Validate one draft before activation.
  activate                Archive current active SOP and activate one approved draft.
  run-loop                Run aggregate -> draft-update -> shadow-test in one go.

Options:
  --sop-id <id>           SOP id such as conversation_to_routes_v1.
  --target-path <path>    Override target SOP path.
  --file <path>           Input review JSON file.
  --status <status>       PASS / FAIL / BLOCK for capture-signal.
  --summary <text>        Short signal summary.
  --advisories-json <json>
  --failed-checks-json <json>
  --metadata-json <json>
  --draft-id <id>         Draft id for shadow-test / activate.
  --approved-by <name>    Human approver required for activate.
  --min-occurrences <n>   Default: 2.
  --json                  Print machine-readable JSON.
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
  let output;

  if (command === "capture-signal") {
    if (!flags["sop-id"]) {
      throw new Error("capture-signal requires --sop-id");
    }
    output = await captureEvolutionSignal(root, {
      sop_id: String(flags["sop-id"]),
      target_path: flags["target-path"] ? String(flags["target-path"]) : null,
      source_kind: flags["source-kind"] ? String(flags["source-kind"]) : "manual",
      source_path: flags["source-path"] ? String(flags["source-path"]) : null,
      status: flags.status ? String(flags.status) : "PASS",
      summary: flags.summary ? String(flags.summary) : "",
      advisories: parseJsonFlag(flags["advisories-json"], []),
      failed_checks: parseJsonFlag(flags["failed-checks-json"], []),
      suggested_next_step: flags["suggested-next-step"] ? String(flags["suggested-next-step"]) : "",
      metadata: parseJsonFlag(flags["metadata-json"], {})
    });
  } else if (command === "ingest-review") {
    if (!flags.file || !flags["sop-id"]) {
      throw new Error("ingest-review requires --file and --sop-id");
    }
    output = await ingestReviewSignal(root, String(flags.file), {
      sop_id: String(flags["sop-id"]),
      target_path: flags["target-path"] ? String(flags["target-path"]) : null,
      source_kind: flags["source-kind"] ? String(flags["source-kind"]) : "review",
      metadata: parseJsonFlag(flags["metadata-json"], {})
    });
  } else if (command === "aggregate") {
    if (!flags["sop-id"]) {
      throw new Error("aggregate requires --sop-id");
    }
    output = await aggregateEvolutionSignals(root, {
      sop_id: String(flags["sop-id"]),
      min_occurrences: Number(flags["min-occurrences"] ?? 2)
    });
  } else if (command === "draft-update") {
    if (!flags["sop-id"]) {
      throw new Error("draft-update requires --sop-id");
    }
    output = await createEvolutionDraft(root, {
      sop_id: String(flags["sop-id"]),
      report_id: flags["report-id"] ? String(flags["report-id"]) : null
    });
  } else if (command === "shadow-test") {
    if (!flags["draft-id"]) {
      throw new Error("shadow-test requires --draft-id");
    }
    output = await shadowTestDraft(root, {
      draft_id: String(flags["draft-id"])
    });
  } else if (command === "activate") {
    if (!flags["draft-id"] || !flags["approved-by"]) {
      throw new Error("activate requires --draft-id and --approved-by");
    }
    output = await activateDraft(root, {
      draft_id: String(flags["draft-id"]),
      approved_by: String(flags["approved-by"])
    });
  } else if (command === "run-loop") {
    if (!flags["sop-id"]) {
      throw new Error("run-loop requires --sop-id");
    }
    output = await runEvolutionLoop(root, {
      sop_id: String(flags["sop-id"]),
      min_occurrences: Number(flags["min-occurrences"] ?? 2)
    });
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
