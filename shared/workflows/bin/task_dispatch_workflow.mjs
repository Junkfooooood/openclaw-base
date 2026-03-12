#!/usr/bin/env node

import fs from "node:fs";

import {
  computeDispatchState,
  finalizeBoardCard,
  findProjectRoot,
  readJsonFromStdin,
  validateTaskTree,
  writeBoardInit,
  writeBoardUpdate,
  writeTaskTreeSnapshot
} from "../../runtime/management/task_dispatch_lib.mjs";

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? next : "true";
    if (args[key] === next) i += 1;
  }
  return { args, positional };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readPayload(args = {}, positional = []) {
  if (args["task-tree-json"]) {
    return JSON.parse(args["task-tree-json"]);
  }
  if (args["payload-json"]) {
    return JSON.parse(args["payload-json"]);
  }
  if (args.file) {
    return readJsonFile(args.file);
  }
  if (positional.length > 0) {
    return readJsonFile(positional[0]);
  }
  return readJsonFromStdin();
}

function printJson(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

function validateDispatchPayload(payload) {
  const issues = [];
  if (!payload || typeof payload !== "object") issues.push("payload is missing or invalid");
  if (!payload.task_id) issues.push("task_id is required");
  if (!payload.title) issues.push("title is required");
  if (!Array.isArray(payload.branches)) issues.push("branches must be an array");

  return issues.length > 0
    ? {
        status: "FAIL",
        reason: "dispatch payload failed structural validation",
        failed_checks: issues,
        suggested_next_step: "repair_dispatch_payload",
        task_id: payload?.task_id ?? null
      }
    : {
        status: "PASS",
        reason: "dispatch payload passed structural validation",
        failed_checks: [],
        suggested_next_step: "continue",
        task_id: payload.task_id
      };
}

async function main() {
  const [command] = process.argv.slice(2);
  const { args, positional } = parseArgs(process.argv.slice(3));
  const root = findProjectRoot();

  switch (command) {
    case "normalize": {
      const payload = readPayload(args, positional);
      const validation = validateTaskTree(payload);
      if (!validation.valid) {
        printJson(
          {
            status: "FAIL",
            reason: "task tree is incomplete or invalid",
            failed_checks: validation.issues,
            suggested_next_step: "fix_task_tree"
          },
          1
        );
        return;
      }
      printJson(validation.taskTree);
      return;
    }
    case "board-init": {
      const payload = readPayload(args, positional);
      const validation = validateTaskTree(payload);
      if (!validation.valid) {
        printJson(
          {
            status: "FAIL",
            reason: "task tree is incomplete or invalid",
            failed_checks: validation.issues,
            suggested_next_step: "fix_task_tree"
          },
          1
        );
        return;
      }
      const target = await writeBoardInit(root, validation.taskTree);
      printJson({
        status: "initialized",
        task_id: validation.taskTree.task_id,
        card_path: target
      });
      return;
    }
    case "board-update": {
      const payload = readPayload(args, positional);
      if (!payload?.task_id) {
        printJson(
          {
            status: "FAIL",
            reason: "board update payload is incomplete or invalid",
            failed_checks: ["task_id"],
            suggested_next_step: "repair_board_payload"
          },
          1
        );
        return;
      }
      const target = await writeBoardUpdate(root, payload);
      printJson({
        status: "updated",
        task_id: payload.task_id,
        card_path: target
      });
      return;
    }
    case "dispatch": {
      const payload = readPayload(args, positional);
      const dispatchState = computeDispatchState(payload);
      if (!dispatchState.valid) {
        printJson(
          {
            status: "FAIL",
            reason: "task tree is incomplete or invalid",
            failed_checks: dispatchState.issues,
            suggested_next_step: "fix_task_tree"
          },
          1
        );
        return;
      }
      const queuePath = await writeTaskTreeSnapshot(root, dispatchState.taskTree);
      printJson({
        task_id: dispatchState.taskTree.task_id,
        title: dispatchState.taskTree.title,
        status: "dispatched",
        queue_path: queuePath,
        ready_branches: dispatchState.ready_branches,
        waiting_branches: dispatchState.waiting_branches,
        branches: dispatchState.branches
      });
      return;
    }
    case "validate": {
      const payload = readPayload(args, positional);
      printJson(validateDispatchPayload(payload));
      return;
    }
    case "approval": {
      const payload = readPayload(args, positional);
      printJson({
        status: "approval_required",
        kind: args.kind ?? "review",
        approved: false,
        task_id: payload.task_id ?? null,
        summary: payload.title ?? payload.reason ?? "approval requested"
      });
      return;
    }
    case "finalize": {
      const payload = readPayload(args, positional);
      if (!payload?.task_id) {
        printJson(
          {
            status: "FAIL",
            reason: "finalize payload is incomplete or invalid",
            failed_checks: ["task_id"],
            suggested_next_step: "repair_finalize_payload"
          },
          1
        );
        return;
      }
      const result = await finalizeBoardCard(root, payload);
      printJson({
        status: "archived",
        task_id: payload.task_id,
        card_path: result.archive_path,
        hot_summary_path: result.hot_path
      });
      return;
    }
    default:
      printJson(
        {
          status: "FAIL",
          reason: `unknown command '${command ?? ""}'`,
          failed_checks: ["unsupported_command"],
          suggested_next_step: "use one of: normalize, board-init, board-update, dispatch, validate, approval, finalize"
        },
        1
      );
  }
}

await main();
