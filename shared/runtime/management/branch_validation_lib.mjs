import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  appendActivityLog,
  branchValidationPath,
  deriveRuntimeBranchStates,
  findProjectRoot,
  readBoardState,
  writeBoardUpdate
} from "./task_dispatch_lib.mjs";
import { managementMemoryDefaults, managementWorkingSessionId, syncManagementRecord } from "./management_memory_bridge.mjs";
import { isPlaceholderReply, waitForAgentFinalReply } from "./openclaw_session_lib.mjs";

function slugify(value, fallback = "item") {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || fallback;
}

function relativePathOrAbsolute(root, targetPath) {
  if (!targetPath) return null;
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(root, absoluteTarget);
  return relative && !relative.startsWith("..") ? relative : absoluteTarget;
}

function tryParseJson(candidate) {
  if (candidate == null) return null;
  try {
    return JSON.parse(String(candidate).trim());
  } catch {
    return null;
  }
}

function extractTrailingJson(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  const direct = tryParseJson(trimmed);
  if (direct) return direct;

  const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fenceMatches.length - 1; i >= 0; i -= 1) {
    const parsed = tryParseJson(fenceMatches[i]?.[1]);
    if (parsed) return parsed;
  }

  let bestMatch = null;
  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < trimmed.length; end += 1) {
      const char = trimmed[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParseJson(trimmed.slice(start, end + 1));
          if (parsed) {
            bestMatch = parsed;
          }
          break;
        }
      }
    }
  }
  return bestMatch;
}

function firstTextLike(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstTextLike(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const preferredKeys = ["reply", "message", "text", "output", "response", "final", "content"];
    for (const key of preferredKeys) {
      if (key in value) {
        const found = firstTextLike(value[key]);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value)) {
      const found = firstTextLike(nested);
      if (found) return found;
    }
  }
  return null;
}

function parseValidatorPayload(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return {
      status: "BLOCK",
      reason: "validator returned empty output",
      failed_checks: ["empty_validator_output"],
      suggested_next_step: "inspect_validator_session"
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeValidation(parsed);
  } catch {
    const extracted = extractTrailingJson(raw);
    if (extracted) {
      return normalizeValidation(extracted);
    }
    const upper = raw.toUpperCase();
    if (upper === "PASS" || upper === "FAIL" || upper === "BLOCK") {
      return normalizeValidation({
        status: upper,
        reason: `validator returned bare status ${upper}`,
        failed_checks: upper === "PASS" ? [] : ["missing_structured_reason"],
        suggested_next_step: upper === "PASS" ? "continue" : "inspect_validator_session"
      });
    }
    return normalizeValidation({
      status: "BLOCK",
      reason: "validator output was not valid JSON",
      failed_checks: ["invalid_validator_output"],
      suggested_next_step: "inspect_validator_session"
    });
  }
}

function normalizeValidation(payload = {}) {
  const status = String(payload.status ?? "BLOCK").trim().toUpperCase();
  const normalizedStatus = ["PASS", "FAIL", "BLOCK"].includes(status) ? status : "BLOCK";
  return {
    status: normalizedStatus,
    reason: String(payload.reason ?? payload.summary ?? "").trim() || `validator returned ${normalizedStatus}`,
    failed_checks: Array.isArray(payload.failed_checks)
      ? payload.failed_checks.map((item) => String(item))
      : [],
    suggested_next_step:
      String(payload.suggested_next_step ?? payload.next_step ?? "").trim() ||
      (normalizedStatus === "PASS" ? "continue" : "inspect_validator_session")
  };
}

function buildValidationPrompt(root, packetPath, resultPath, boardPath, route) {
  const requiredFiles = [
    path.resolve(root, "shared/policies/Validation_Rules.md"),
    path.resolve(root, "shared/policies/Core_Routing.md"),
    path.resolve(root, "shared/sop/active/Task_Dispatch_SOP_v1.md"),
    packetPath,
    resultPath
  ];
  if (route === "strategy_review") {
    requiredFiles.push(path.resolve(root, "shared/sop/active/Strategy_Review_Route_SOP_v1.md"));
  }
  if (boardPath) {
    requiredFiles.push(boardPath);
  }

  return [
    "You are validating a completed management branch.",
    "Read every file listed below before deciding:",
    ...requiredFiles.map((item) => `- ${item}`),
    "",
    "Validation contract:",
    "- Return ONLY a JSON object. No markdown fence. No extra prose.",
    '- JSON schema: {"status":"PASS|FAIL|BLOCK","reason":"string","failed_checks":["..."],"suggested_next_step":"string"}',
    "- PASS only if output exists, structure is complete, no obvious logic conflict, no unauthorized action, and blackboard/activity traces are consistent.",
    "- FAIL if the branch is fixable by the original owner.",
    "- BLOCK if environment/input/approval/safety prevents a safe retry.",
    "- If branch output uses search/browse/retrieval, check whether Search Trace exists and matches the result.",
    "",
    "Important:",
    "- Do not repair the branch.",
    "- Do not produce a summary outside JSON.",
    "- If the branch route is strategy_review, ensure it stayed low-tool and did not smuggle file/web/device execution.",
    "- Treat semantic coverage of expected outputs as sufficient unless a strict schema explicitly requires named sections.",
    "- If the packet route/model contract is correct but runtime metadata shows a provider/model fallback, treat that as advisory rather than FAIL unless output quality or route boundaries are broken."
  ].join("\n");
}

function runValidatorAgent(root, packetPath, resultPath, boardPath, route, options = {}) {
  const openclawBin = options.openclawBin ?? "openclaw";
  const timeoutSeconds = Number(options.timeoutSeconds ?? 180);
  const startedAt = Date.now();
  const sessionId = [
    "validate",
    slugify(path.basename(packetPath, ".json"), "branch"),
    slugify(Date.now(), "now")
  ].join("-");
  const args = [
    "--log-level",
    "error",
    "agent",
    "--agent",
    "validator",
    "--local",
    "--json",
    "--session-id",
    sessionId,
    "--message",
    buildValidationPrompt(root, packetPath, resultPath, boardPath, route),
    "--timeout",
    String(timeoutSeconds)
  ];

  return new Promise((resolve) => {
    const child = spawn(openclawBin, args, {
      cwd: root,
      env: {
        ...process.env
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      const parsed = extractTrailingJson(stdout);
      const initialText = firstTextLike(parsed) ?? stdout.trim();
      resolve({ exit_code: code ?? 1, ok: (code ?? 1) === 0, stdout, stderr, parsed, text: initialText, started_at: startedAt });
    });
    child.on("error", (error) => {
      resolve({
        exit_code: 1,
        ok: false,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        parsed: null,
        text: stdout.trim(),
        started_at: startedAt
      });
    });
  });
}

async function writeValidationFile(root, taskId, branchId, payload, config = {}) {
  const filePath = branchValidationPath(root, taskId, branchId, config);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

export async function validateExecutedBranches(rootOrPayload, maybePayload = null, maybeConfig = {}) {
  const root = maybePayload ? rootOrPayload : findProjectRoot();
  const payload = maybePayload ?? rootOrPayload;
  const config = maybePayload ? maybeConfig : {};
  const memoryConfig = managementMemoryDefaults(root);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const taskId = payload?.task_id ?? null;
  const validationResults = [];

  for (const resultInfo of results) {
    const packetPath = path.resolve(root, resultInfo.packet_path);
    const resultPath = path.resolve(root, resultInfo.result_path);
    const boardPath = resultInfo.board_path ? path.resolve(root, resultInfo.board_path) : null;
    const packet = JSON.parse(await fsp.readFile(packetPath, "utf8"));
    const resultPayload = JSON.parse(await fsp.readFile(resultPath, "utf8"));
    const taskTreePath = path.resolve(root, packet.inputs.task_tree_path);
    const taskTree = JSON.parse(await fsp.readFile(taskTreePath, "utf8"));
    const boardState = await readBoardState(root, taskId, config);
    const retryCount = {
      ...(boardState.retry_count ?? {})
    };

    await appendActivityLog(
      root,
      taskId,
      {
        branch_id: packet.branch.branch_id,
        owner: "validator",
        route: packet.branch.route,
        tool_mode: "standard",
        model_hint: "validator/default",
        event: "branch_validation_started",
        status: "running",
        packet_path: relativePathOrAbsolute(root, packetPath),
        result_path: relativePathOrAbsolute(root, resultPath)
      },
      config
    );

    const execution = await runValidatorAgent(
      root,
      packetPath,
      resultPath,
      boardPath,
      packet.branch.route,
      config
    );
    if (isPlaceholderReply(execution.text) || !String(execution.text ?? "").trim().startsWith("{")) {
      const finalReply = await waitForAgentFinalReply(root, "validator", execution.started_at, {
        timeoutMs: Number(config.timeoutSeconds ?? 180) * 1000,
        accept: (candidate) =>
          candidate.stopReason === "stop" &&
          !isPlaceholderReply(candidate.text) &&
          Boolean(extractTrailingJson(candidate.text) || candidate.text.trim().startsWith("{"))
      });
      if (finalReply?.text) {
        execution.text = finalReply.text;
        execution.final_reply = finalReply;
      }
    }
    const validation = parseValidatorPayload(execution.text);

    if (validation.status === "FAIL") {
      retryCount[packet.branch.branch_id] = Number(retryCount[packet.branch.branch_id] ?? 0) + 1;
    }

    const validationFilePath = await writeValidationFile(
      root,
      taskId,
      packet.branch.branch_id,
      {
        packet,
        result: resultPayload,
        validation,
        validator_execution: execution,
        created_at: new Date().toISOString()
      },
      config
    );

    const validationMemory = await syncManagementRecord(root, {
      kind: "validation_result",
      task_id: taskId,
      branch_id: packet.branch.branch_id,
      owner: "validator",
      route: packet.branch.route,
      tool_mode: packet.branch.tool_mode,
      model_hint: packet.branch.model_hint,
      title: packet.title,
      summary: `${validation.status}: ${validation.reason}`,
      detail: JSON.stringify(validation, null, 2),
      session_id: managementWorkingSessionId(taskId, packet.branch.branch_id),
      tags: ["management", "validation", validation.status.toLowerCase(), packet.branch.owner],
      sync_semantic_graph: false
    }).catch((error) => ({ status: "error", error: error.message }));

    const derived = await deriveRuntimeBranchStates(root, taskTree, {}, { ...config, retryCountOverride: retryCount });
    const routeNotes = derived.branches
      .filter((branch) => branch.route === "strategy_review")
      .map(
        (branch) =>
          `${branch.branch_id} uses strategy_review with ${branch.model_hint} and low-tool policy`
      );
    const hasBlocked = derived.branches.some((branch) => branch.status === "blocked");
    const allDone = derived.branches.every((branch) => branch.status === "done");
    const nextReady = derived.ready_branches;

    await writeBoardUpdate(
      root,
      {
        task_id: taskId,
        status: hasBlocked ? "blocked" : allDone ? "completed" : "in_progress",
        current_branch: allDone ? "main" : nextReady[0] ?? packet.branch.branch_id,
        branch_status: derived.branch_status_lines,
        last_action: `validator ${validation.status} for ${packet.branch.branch_id}: ${validation.reason}`,
        current_outputs: [
          relativePathOrAbsolute(root, resultPath),
          relativePathOrAbsolute(root, validationFilePath)
        ],
        next_step: hasBlocked
          ? "notify_human"
          : allDone
            ? "finalize"
            : nextReady.length > 0
              ? `dispatch ready branches: ${nextReady.join(", ")}`
              : validation.suggested_next_step,
        blocker: validation.status === "BLOCK" ? validation.reason : null,
        retry_count: retryCount,
        route_notes: routeNotes
      },
      config
    );

    await appendActivityLog(
      root,
      taskId,
      {
        branch_id: packet.branch.branch_id,
        owner: "validator",
        route: packet.branch.route,
        tool_mode: "standard",
        model_hint: "validator/default",
        event: "branch_validation_finished",
        status: validation.status.toLowerCase(),
        packet_path: relativePathOrAbsolute(root, packetPath),
        result_path: relativePathOrAbsolute(root, resultPath),
        validation_path: relativePathOrAbsolute(root, validationFilePath)
      },
      config
    );

    validationResults.push({
      branch_id: packet.branch.branch_id,
      owner: packet.branch.owner,
      status: validation.status,
      reason: validation.reason,
      failed_checks: validation.failed_checks,
      suggested_next_step: validation.suggested_next_step,
      validation_path: relativePathOrAbsolute(root, validationFilePath),
      memory: validationMemory
    });
  }

  return {
    status: "validated",
    task_id: taskId,
    validated_count: validationResults.length,
    results: validationResults
  };
}
