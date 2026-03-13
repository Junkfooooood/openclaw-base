import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  appendActivityLog,
  branchMarkdownResultPath,
  branchResultPath,
  cardPath,
  deriveRuntimeBranchStates,
  findProjectRoot,
  resolveBoardDirs,
  writeBoardUpdate
} from "./task_dispatch_lib.mjs";
import { managementMemoryDefaults, managementWorkingSessionId, syncManagementRecord } from "./management_memory_bridge.mjs";
import { isPlaceholderReply, waitForAgentFinalReply } from "./openclaw_session_lib.mjs";

function relativePathOrAbsolute(root, targetPath) {
  if (!targetPath) return null;
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(root, absoluteTarget);
  return relative && !relative.startsWith("..") ? relative : absoluteTarget;
}

function extractTrailingJson(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  for (let i = trimmed.lastIndexOf("{"); i >= 0; i = trimmed.lastIndexOf("{", i - 1)) {
    const candidate = trimmed.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue scanning backwards
    }
  }
  return null;
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

function sectionBody(text, heading) {
  const source = String(text ?? "");
  const pattern = new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, "im");
  const match = source.match(pattern);
  return match ? match[1].trim() : "";
}

function cleanListBlock(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);
}

function buildExecutionPrompt(packet) {
  return [
    `Read branch packet at ${packet.transparency.packet_path}.`,
    `Execute only branch ${packet.branch.branch_id} for task ${packet.task_id}.`,
    "Use the packet instructions as the primary contract.",
    "If you use web search, retrieval, or browsing, you must record the exact query/process in the final report.",
    "",
    "Return a markdown report with exactly these top-level headings:",
    "## Status",
    "## Summary",
    "## Outputs",
    "## Search Trace",
    "## Risks",
    "## Next Step",
    "",
    "Rules:",
    "- Under Search Trace, list each query/process as bullet points.",
    "- If no search was used, write '- none'.",
    "- Under Outputs, include concrete file paths or artifacts if any.",
    "- Keep the report concise and branch-scoped."
  ].join("\n");
}

function runOpenClawAgent(root, packet, options = {}) {
  const openclawBin = options.openclawBin ?? "openclaw";
  const timeoutSeconds = Number(options.timeoutSeconds ?? 180);
  const startedAt = Date.now();
  const args = [
    "--log-level",
    "error",
    "agent",
    "--agent",
    packet.branch.owner,
    "--local",
    "--json",
    "--session-id",
    packet.execution.session_id,
    "--message",
    buildExecutionPrompt(packet),
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

function looksLikeFinalBranchReport(text) {
  const normalized = String(text ?? "").trim();
  if (isPlaceholderReply(normalized)) return false;
  return normalized.includes("## Status") && normalized.includes("## Summary");
}

async function loadMarkdownResultFallback(root, packet, config = {}) {
  const markdownPath = branchMarkdownResultPath(root, packet.task_id, packet.branch.branch_id, config);
  if (!fs.existsSync(markdownPath)) {
    return null;
  }

  const markdown = await fsp.readFile(markdownPath, "utf8");
  if (!looksLikeFinalBranchReport(markdown)) {
    return null;
  }

  return {
    text: markdown,
    artifact_path: markdownPath
  };
}

function resultFilePath(root, taskId, branchId, config = {}) {
  return branchResultPath(root, taskId, branchId, config);
}

async function writeResultFile(root, packet, result, config = {}) {
  const filePath = resultFilePath(root, packet.task_id, packet.branch.branch_id, config);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}

async function updateBranchBoard(root, packet, branchStatus, resultPaths, summary, nextStep, blocker, config = {}) {
  const boardDirs = resolveBoardDirs(root, config);
  const boardPath = cardPath(boardDirs.hotDir, packet.task_id);
  if (!fs.existsSync(boardPath)) {
    return null;
  }

  const taskTree = JSON.parse(await fsp.readFile(packet.inputs.task_tree_path, "utf8"));
  const derived = await deriveRuntimeBranchStates(root, taskTree, { [packet.branch.branch_id]: branchStatus }, config);
  const routeNotes = derived.branches
    .filter((branch) => branch.route === "strategy_review")
    .map(
      (branch) =>
        `${branch.branch_id} uses strategy_review with ${branch.model_hint} and low-tool policy`
    );

  await writeBoardUpdate(
    root,
    {
      task_id: packet.task_id,
      status: branchStatus === "blocked" ? "blocked" : "in_progress",
      current_branch: packet.branch.branch_id,
      branch_status: derived.branch_status_lines,
      last_action: summary,
      current_outputs:
        Array.isArray(resultPaths) && resultPaths.length > 0
          ? resultPaths
          : resultPaths
            ? [resultPaths]
            : ["branch execution attempted"],
      next_step: nextStep,
      blocker,
      route_notes: routeNotes
    },
    config
  );

  return boardPath;
}

export async function executeReadyBranches(rootOrPayload, maybePayload = null, maybeConfig = {}) {
  const root = maybePayload ? rootOrPayload : findProjectRoot();
  const payload = maybePayload ?? rootOrPayload;
  const config = maybePayload ? maybeConfig : {};
  const memoryConfig = managementMemoryDefaults(root);

  const packets = Array.isArray(payload?.packets)
    ? payload.packets
    : [];
  const taskId = payload?.task_id ?? null;
  const results = [];

  for (const packetInfo of packets) {
    const packetPath = path.resolve(root, packetInfo.packet_path);
    const packet = JSON.parse(await fsp.readFile(packetPath, "utf8"));

    await appendActivityLog(
      root,
      taskId,
      {
        branch_id: packet.branch.branch_id,
        owner: packet.branch.owner,
        route: packet.branch.route,
        tool_mode: packet.branch.tool_mode,
        model_hint: packet.branch.model_hint,
        event: "branch_execution_started",
        status: "running",
        packet_path: packetInfo.packet_path
      },
      config
    );

    const startMemory = await syncManagementRecord(root, {
      kind: "execution_start",
      task_id: packet.task_id,
      branch_id: packet.branch.branch_id,
      owner: packet.branch.owner,
      route: packet.branch.route,
      tool_mode: packet.branch.tool_mode,
      model_hint: packet.branch.model_hint,
      title: packet.title,
      summary: `Started execution for branch ${packet.branch.branch_id}`,
      detail: packet.instructions,
      session_id: managementWorkingSessionId(packet.task_id, packet.branch.branch_id),
      tags: ["management", "execution-start", packet.branch.owner, packet.branch.route],
      sync_semantic_graph: false
    }).catch((error) => ({ status: "error", error: error.message }));

    await updateBranchBoard(
      root,
      packet,
      "running",
      null,
      `Started execution for ${packet.branch.branch_id}`,
      `wait for ${packet.branch.owner} branch output`,
      null,
      config
    );

    const execution = await runOpenClawAgent(root, packet, config);
    if (!looksLikeFinalBranchReport(execution.text)) {
      const finalReply = await waitForAgentFinalReply(root, packet.branch.owner, execution.started_at, {
        timeoutMs: Number(config.timeoutSeconds ?? 180) * 1000,
        accept: (candidate) =>
          candidate.stopReason === "stop" &&
          !isPlaceholderReply(candidate.text) &&
          candidate.text.includes("## Status") &&
          candidate.text.includes("## Summary")
      });
      if (finalReply?.text) {
        execution.text = finalReply.text;
        execution.final_reply = finalReply;
      }
    }
    const markdownFallback = await loadMarkdownResultFallback(root, packet, config);
    if (markdownFallback?.text) {
      execution.text = markdownFallback.text;
      execution.result_markdown_path = markdownFallback.artifact_path;
    }
    const summary = sectionBody(execution.text, "Summary") || execution.stderr || execution.text || "branch execution completed";
    const outputs = cleanListBlock(sectionBody(execution.text, "Outputs"));
    const searchTrace = cleanListBlock(sectionBody(execution.text, "Search Trace"));
    const nextStep = sectionBody(execution.text, "Next Step") || "hand back to validator";
    const risks = cleanListBlock(sectionBody(execution.text, "Risks"));
    const resultStatus = execution.ok ? "completed_pending_validation" : "blocked";

    const resultPath = await writeResultFile(
      root,
      packet,
      {
        packet,
        execution,
        parsed_sections: {
          summary,
          outputs,
          search_trace: searchTrace,
          next_step: nextStep,
          risks
        },
        memory_start: startMemory
      },
      config
    );

    await appendActivityLog(
      root,
      taskId,
      {
        branch_id: packet.branch.branch_id,
        owner: packet.branch.owner,
        route: packet.branch.route,
        tool_mode: packet.branch.tool_mode,
        model_hint: packet.branch.model_hint,
        event: execution.ok ? "branch_execution_finished" : "branch_execution_failed",
        status: resultStatus,
        packet_path: packetInfo.packet_path,
        result_path: relativePathOrAbsolute(root, resultPath)
      },
      config
    );

    const resultMemory = await syncManagementRecord(root, {
      kind: "branch_result",
      task_id: packet.task_id,
      branch_id: packet.branch.branch_id,
      owner: packet.branch.owner,
      route: packet.branch.route,
      tool_mode: packet.branch.tool_mode,
      model_hint: packet.branch.model_hint,
      title: packet.title,
      summary,
      detail: execution.text || execution.stderr,
      semantic_text: summary,
      session_id: managementWorkingSessionId(packet.task_id, packet.branch.branch_id),
      tags: ["management", "branch-result", packet.branch.owner, packet.branch.route],
      sync_semantic_graph:
        packet.branch.route === "strategy_review" && memoryConfig.syncStrategyReviewToSemanticGraph
    }).catch((error) => ({ status: "error", error: error.message }));

    let searchMemory = null;
    if (
      memoryConfig.syncSearchTraceToWorking &&
      searchTrace.length > 0 &&
      !searchTrace.every((item) => item.toLowerCase() === "none")
    ) {
      searchMemory = await syncManagementRecord(root, {
        kind: "search_trace",
        task_id: packet.task_id,
        branch_id: packet.branch.branch_id,
        owner: packet.branch.owner,
        route: packet.branch.route,
        tool_mode: packet.branch.tool_mode,
        model_hint: packet.branch.model_hint,
        title: packet.title,
        summary: `Search trace recorded for branch ${packet.branch.branch_id}`,
        detail: searchTrace.map((item) => `- ${item}`).join("\n"),
        session_id: managementWorkingSessionId(packet.task_id, packet.branch.branch_id),
        tags: ["management", "search-trace", packet.branch.owner, packet.branch.route],
        sync_semantic_graph: memoryConfig.syncSearchTraceToSemanticGraph
      }).catch((error) => ({ status: "error", error: error.message }));
    }

    const boardOutputs = [relativePathOrAbsolute(root, resultPath)];
    if (execution.result_markdown_path) {
      boardOutputs.push(relativePathOrAbsolute(root, execution.result_markdown_path));
    }

    const boardPath = await updateBranchBoard(
      root,
      packet,
      resultStatus,
      boardOutputs,
      summary,
      execution.ok ? "send branch output to validator" : "inspect error and decide retry or block",
      execution.ok ? null : execution.stderr || "branch execution failed",
      config
    );

    results.push({
      branch_id: packet.branch.branch_id,
      owner: packet.branch.owner,
      route: packet.branch.route,
      status: resultStatus,
      packet_path: packetInfo.packet_path,
      result_path: relativePathOrAbsolute(root, resultPath),
      board_path: boardPath ? relativePathOrAbsolute(root, boardPath) : null,
      memory: {
        start: startMemory,
        result: resultMemory,
        search_trace: searchMemory
      },
      outputs,
      search_trace: searchTrace,
      next_step: execution.ok ? "validator" : "main_decision_required",
      stderr: execution.stderr || null
    });
  }

  return {
    status: "executed",
    task_id: taskId,
    executed_count: results.length,
    results
  };
}
