#!/usr/bin/env node

import fs from "node:fs";

import { executeReadyBranches } from "../../runtime/management/branch_execution_lib.mjs";
import { validateExecutedBranches } from "../../runtime/management/branch_validation_lib.mjs";
import {
  computeDispatchState,
  deriveRuntimeBranchStates,
  finalizeBoardCard,
  findProjectRoot,
  handoffReadyBranches,
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

function buildRuntimeConfig(args = {}) {
  const config = {};
  if (args["hot-dir"]) config.hotDir = args["hot-dir"];
  if (args["archive-dir"]) config.archiveDir = args["archive-dir"];
  if (args["queue-dir"]) config.queueDir = args["queue-dir"];
  if (args["dispatch-dir"]) config.dispatchDir = args["dispatch-dir"];
  if (args["activity-dir"]) config.activityDir = args["activity-dir"];
  if (args["queue-path"]) config.queuePath = args["queue-path"];
  if (args["openclaw-bin"]) config.openclawBin = args["openclaw-bin"];
  if (args["timeout-seconds"]) config.timeoutSeconds = Number(args["timeout-seconds"]);
  return config;
}

function resolveTaskTreeForHandoff(rawPayload) {
  if (rawPayload?.task_tree && typeof rawPayload.task_tree === "object") {
    return {
      taskTree: rawPayload.task_tree,
      queuePath: rawPayload.queue_path ?? null
    };
  }

  if (rawPayload?.queue_path) {
    return {
      taskTree: readJsonFile(rawPayload.queue_path),
      queuePath: rawPayload.queue_path
    };
  }

  return {
    taskTree: rawPayload,
    queuePath: null
  };
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

function buildFinalizePayload(taskTree, runtimeState, queuePath) {
  const outputPaths = [
    queuePath,
    ...runtimeState.branches.flatMap((branch) => [branch.result_path, branch.validation_path]).filter(Boolean)
  ];

  return {
    task_id: taskTree.task_id,
    title: taskTree.title,
    summary: `Management workflow completed with ${runtimeState.completed_branches.length} branches validated PASS.`,
    output_paths: outputPaths
  };
}

async function collectPendingValidationPayload(root, taskTree, runtimeConfig) {
  const runtimeState = await deriveRuntimeBranchStates(root, taskTree, {}, runtimeConfig);
  return {
    task_id: taskTree.task_id,
    results: runtimeState.branches
      .filter(
        (branch) =>
          branch.status === "completed_pending_validation" &&
          branch.packet_path &&
          branch.result_path
      )
      .map((branch) => ({
        branch_id: branch.branch_id,
        owner: branch.owner,
        packet_path: branch.packet_path,
        result_path: branch.result_path,
        board_path: runtimeState.board_path
      }))
  };
}

async function runFullWorkflow(root, taskTree, runtimeConfig) {
  const queuePath = await writeTaskTreeSnapshot(root, taskTree, runtimeConfig);
  const boardPath = await writeBoardInit(root, taskTree, runtimeConfig);
  const maxRetries = Number(taskTree.retry_policy?.max_retries ?? 3);
  const maxIterations = Math.max(taskTree.branches.length * (maxRetries + 2), 6);
  const iterations = [];
  let finalizeResult = null;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const stateBefore = await deriveRuntimeBranchStates(root, taskTree, {}, runtimeConfig);
    if (stateBefore.branches.every((branch) => branch.status === "done")) {
      finalizeResult = await finalizeBoardCard(
        root,
        buildFinalizePayload(taskTree, stateBefore, queuePath),
        runtimeConfig
      );
      return {
        status: "archived",
        task_id: taskTree.task_id,
        queue_path: queuePath,
        card_path: finalizeResult.archive_path,
        hot_summary_path: finalizeResult.hot_path,
        iterations,
        branch_status: stateBefore.branch_status_lines
      };
    }
    if (stateBefore.blocked_branches.length > 0) {
      return {
        status: "blocked",
        task_id: taskTree.task_id,
        queue_path: queuePath,
        card_path: boardPath,
        blocked_branches: stateBefore.blocked_branches,
        branch_status: stateBefore.branch_status_lines,
        iterations
      };
    }

    const handoff = await handoffReadyBranches(root, taskTree, {
      ...runtimeConfig,
      queuePath: runtimeConfig.queuePath ?? queuePath
    });
    let executed = null;
    let validated = null;

    if ((handoff.handoff_count ?? 0) > 0) {
      executed = await executeReadyBranches(root, handoff, runtimeConfig);
      if ((executed.executed_count ?? 0) > 0) {
        validated = await validateExecutedBranches(root, executed, runtimeConfig);
      }
    } else {
      const pendingValidation = await collectPendingValidationPayload(root, taskTree, runtimeConfig);
      if (pendingValidation.results.length > 0) {
        validated = await validateExecutedBranches(root, pendingValidation, runtimeConfig);
      }
    }

    const stateAfter = await deriveRuntimeBranchStates(root, taskTree, {}, runtimeConfig);
    iterations.push({
      iteration,
      ready_before: stateBefore.ready_branches,
      handoff_count: handoff.handoff_count ?? 0,
      executed_count: executed?.executed_count ?? 0,
      validated_count: validated?.validated_count ?? 0,
      ready_after: stateAfter.ready_branches,
      blocked_after: stateAfter.blocked_branches,
      completed_after: stateAfter.completed_branches
    });

    const progressCount =
      (handoff.handoff_count ?? 0) +
      (executed?.executed_count ?? 0) +
      (validated?.validated_count ?? 0);
    if (progressCount === 0) {
      return {
        status: "FAIL",
        reason: "workflow made no progress",
        failed_checks: ["no_progress"],
        suggested_next_step: "inspect_hot_board_and_runtime_artifacts",
        task_id: taskTree.task_id,
        queue_path: queuePath,
        card_path: boardPath,
        branch_status: stateAfter.branch_status_lines,
        iterations
      };
    }
  }

  const finalState = await deriveRuntimeBranchStates(root, taskTree, {}, runtimeConfig);
  if (finalState.branches.every((branch) => branch.status === "done")) {
    finalizeResult = await finalizeBoardCard(
      root,
      buildFinalizePayload(taskTree, finalState, queuePath),
      runtimeConfig
    );
    return {
      status: "archived",
      task_id: taskTree.task_id,
      queue_path: queuePath,
      card_path: finalizeResult.archive_path,
      hot_summary_path: finalizeResult.hot_path,
      iterations,
      branch_status: finalState.branch_status_lines
    };
  }

  return {
    status: "FAIL",
    reason: "workflow hit iteration limit before completion",
    failed_checks: ["iteration_limit_reached"],
    suggested_next_step: "inspect_hot_board_and_runtime_artifacts",
    task_id: taskTree.task_id,
    queue_path: queuePath,
    card_path: boardPath,
    branch_status: finalState.branch_status_lines,
    iterations
  };
}

async function main() {
  const [command] = process.argv.slice(2);
  const { args, positional } = parseArgs(process.argv.slice(3));
  const root = findProjectRoot();
  const runtimeConfig = buildRuntimeConfig(args);

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
      const target = await writeBoardInit(root, validation.taskTree, runtimeConfig);
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
      const target = await writeBoardUpdate(root, payload, runtimeConfig);
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
      const queuePath = await writeTaskTreeSnapshot(root, dispatchState.taskTree, runtimeConfig);
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
    case "handoff": {
      const rawPayload = readPayload(args, positional);
      const { taskTree, queuePath } = resolveTaskTreeForHandoff(rawPayload);
      const result = await handoffReadyBranches(root, taskTree, {
        ...runtimeConfig,
        queuePath: runtimeConfig.queuePath ?? queuePath
      });
      if (!result.valid) {
        printJson(
          {
            status: "FAIL",
            reason: "task tree is incomplete or invalid",
            failed_checks: result.issues,
            suggested_next_step: "fix_task_tree"
          },
          1
        );
        return;
      }
      printJson(result);
      return;
    }
    case "execute-ready": {
      const rawPayload = readPayload(args, positional);
      const result = await executeReadyBranches(root, rawPayload, runtimeConfig);
      printJson(result);
      return;
    }
    case "validate-results": {
      const rawPayload = readPayload(args, positional);
      const result = await validateExecutedBranches(root, rawPayload, runtimeConfig);
      printJson(result);
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
      const result = await finalizeBoardCard(root, payload, runtimeConfig);
      printJson({
        status: "archived",
        task_id: payload.task_id,
        card_path: result.archive_path,
        hot_summary_path: result.hot_path
      });
      return;
    }
    case "run-full": {
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
      const result = await runFullWorkflow(root, validation.taskTree, runtimeConfig);
      printJson(result, result.status === "FAIL" ? 1 : 0);
      return;
    }
    default:
      printJson(
        {
          status: "FAIL",
          reason: `unknown command '${command ?? ""}'`,
          failed_checks: ["unsupported_command"],
          suggested_next_step:
            "use one of: normalize, board-init, board-update, dispatch, handoff, execute-ready, validate-results, validate, approval, finalize, run-full"
        },
        1
      );
  }
}

await main();
