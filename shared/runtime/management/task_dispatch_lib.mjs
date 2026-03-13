import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  managementMemoryDefaults,
  managementWorkingSessionId,
  syncManagementRecord
} from "./management_memory_bridge.mjs";

export const KNOWN_OWNERS = new Set([
  "main",
  "learning",
  "curator",
  "executor",
  "validator"
]);

export const KNOWN_EXECUTION_ROUTES = new Set(["default", "strategy_review"]);
export const KNOWN_TOOL_MODES = new Set(["standard", "low_tool"]);
export const KNOWN_VISIBILITY = new Set(["transparent", "transparent_summary"]);

const STRATEGY_KEYWORDS = [
  "战略",
  "复盘",
  "回顾",
  "决策",
  "取舍",
  "规划",
  "strategy",
  "retro",
  "review",
  "decision"
];

function stableStringify(value) {
  return JSON.stringify(value);
}

function slugify(value, fallback = "item") {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || fallback;
}

export function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, "shared")) &&
      fs.existsSync(path.join(current, "workspace-main"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

export function readJsonFromStdin() {
  const raw = fs.readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function shouldUseStrategyReviewRoute(branch = {}, taskTree = {}) {
  const haystack = [
    branch.goal,
    ...(branch.expected_output ?? []),
    ...(branch.acceptance ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return STRATEGY_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function defaultModelHint(owner, route) {
  if (route === "strategy_review") return "deepseek/deepseek-reasoner";

  switch (owner) {
    case "learning":
    case "curator":
      return "moonshot/kimi-k2.5";
    case "validator":
      return "qwen-portal/coder-model";
    case "executor":
    case "main":
    default:
      return "openai-codex/gpt-5.4";
  }
}

function normalizeBranch(branch, taskTree) {
  let route = "default";
  if (branch.route) {
    route = String(branch.route).trim().toLowerCase();
  } else if (String(branch.owner ?? "").trim() !== "executor" && shouldUseStrategyReviewRoute(branch, taskTree)) {
    route = "strategy_review";
  }

  const toolMode =
    branch.tool_mode ??
    (route === "strategy_review" ? "low_tool" : "standard");

  const visibility =
    branch.visibility ??
    (route === "strategy_review" ? "transparent_summary" : "transparent");

  const normalizedOwner = String(branch.owner ?? "").trim();

  return {
    ...branch,
    branch_id: String(branch.branch_id ?? "").trim(),
    owner: normalizedOwner,
    goal: String(branch.goal ?? "").trim(),
    depends_on: Array.isArray(branch.depends_on)
      ? branch.depends_on.map((item) => String(item))
      : [],
    expected_output: Array.isArray(branch.expected_output)
      ? branch.expected_output.map((item) => String(item))
      : [],
    acceptance: Array.isArray(branch.acceptance)
      ? branch.acceptance.map((item) => String(item))
      : [],
    route,
    tool_mode: String(toolMode).trim().toLowerCase(),
    model_hint: String(branch.model_hint ?? defaultModelHint(normalizedOwner, route)).trim(),
    visibility: String(visibility).trim().toLowerCase()
  };
}

export function normalizeTaskTree(input = {}) {
  const taskTree = {
    task_id: String(input.task_id ?? "").trim(),
    title: String(input.title ?? "").trim(),
    mode:
      input.mode ??
      ((Array.isArray(input.branches) ? input.branches.length : 0) > 1 ? "multi" : "single"),
    approval_mode: input.approval_mode ?? "review",
    retry_policy: input.retry_policy ?? {
      max_retries: 3,
      on_fail: "notify_human"
    }
  };

  taskTree.branches = Array.isArray(input.branches)
    ? input.branches.map((branch) => normalizeBranch(branch, { ...input, ...taskTree }))
    : [];

  return taskTree;
}

function detectCycle(branchMap) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function walk(branchId) {
    if (visited.has(branchId)) return null;
    if (visiting.has(branchId)) {
      const idx = stack.indexOf(branchId);
      return [...stack.slice(idx), branchId];
    }

    visiting.add(branchId);
    stack.push(branchId);
    const branch = branchMap.get(branchId);
    for (const dep of branch?.depends_on ?? []) {
      const cycle = walk(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(branchId);
    visited.add(branchId);
    return null;
  }

  for (const branchId of branchMap.keys()) {
    const cycle = walk(branchId);
    if (cycle) return cycle;
  }
  return null;
}

export function validateTaskTree(input = {}) {
  const taskTree = normalizeTaskTree(input);
  const issues = [];
  const branchIds = new Set();
  const branchMap = new Map();

  if (!taskTree.task_id) issues.push("task_id");
  if (!taskTree.title) issues.push("title");
  if (!taskTree.mode) issues.push("mode");
  if (!taskTree.approval_mode) issues.push("approval_mode");
  if (!taskTree.retry_policy) {
    issues.push("retry_policy");
  } else {
    if (!Number.isInteger(taskTree.retry_policy.max_retries) || taskTree.retry_policy.max_retries < 1) {
      issues.push("retry_policy.max_retries");
    }
    if (!["retry", "block", "notify_human"].includes(taskTree.retry_policy.on_fail)) {
      issues.push("retry_policy.on_fail");
    }
  }
  if (!Array.isArray(taskTree.branches) || taskTree.branches.length === 0) {
    issues.push("branches");
    return { valid: issues.length === 0, issues, taskTree };
  }

  taskTree.branches.forEach((branch, idx) => {
    if (!branch.branch_id) issues.push(`branches[${idx}].branch_id`);
    if (!branch.owner) {
      issues.push(`branches[${idx}].owner`);
    } else if (!KNOWN_OWNERS.has(branch.owner)) {
      issues.push(`branches[${idx}].owner:${branch.owner}`);
    }
    if (!branch.goal) issues.push(`branches[${idx}].goal`);
    if (!Array.isArray(branch.expected_output) || branch.expected_output.length === 0) {
      issues.push(`branches[${idx}].expected_output`);
    }
    if (!Array.isArray(branch.acceptance) || branch.acceptance.length === 0) {
      issues.push(`branches[${idx}].acceptance`);
    }
    if (!KNOWN_EXECUTION_ROUTES.has(branch.route)) {
      issues.push(`branches[${idx}].route:${branch.route}`);
    }
    if (!KNOWN_TOOL_MODES.has(branch.tool_mode)) {
      issues.push(`branches[${idx}].tool_mode:${branch.tool_mode}`);
    }
    if (!branch.model_hint) {
      issues.push(`branches[${idx}].model_hint`);
    }
    if (!KNOWN_VISIBILITY.has(branch.visibility)) {
      issues.push(`branches[${idx}].visibility:${branch.visibility}`);
    }
    if (branch.route === "strategy_review") {
      if (branch.tool_mode !== "low_tool") {
        issues.push(`branches[${idx}].tool_mode must be low_tool for strategy_review`);
      }
      if (!branch.model_hint.includes("deepseek/deepseek-reasoner")) {
        issues.push(`branches[${idx}].model_hint should prefer deepseek/deepseek-reasoner`);
      }
    }
    if (branchIds.has(branch.branch_id)) {
      issues.push(`duplicate_branch_id:${branch.branch_id}`);
    }
    branchIds.add(branch.branch_id);
    branchMap.set(branch.branch_id, branch);
  });

  for (const branch of taskTree.branches) {
    for (const dep of branch.depends_on ?? []) {
      if (!branchMap.has(dep)) {
        issues.push(`unknown_dependency:${branch.branch_id}->${dep}`);
      }
    }
  }

  const cycle = detectCycle(branchMap);
  if (cycle) {
    issues.push(`dependency_cycle:${cycle.join(" -> ")}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    taskTree
  };
}

export function computeDispatchState(taskTreeInput = {}) {
  const { valid, issues, taskTree } = validateTaskTree(taskTreeInput);
  if (!valid) {
    return {
      valid,
      issues,
      taskTree
    };
  }

  const branches = taskTree.branches.map((branch) => {
    const hasDependencies = (branch.depends_on ?? []).length > 0;
    return {
      branch_id: branch.branch_id,
      owner: branch.owner,
      goal: branch.goal,
      status: hasDependencies ? "waiting_on_dependencies" : "ready",
      depends_on: branch.depends_on ?? [],
      route: branch.route,
      tool_mode: branch.tool_mode,
      model_hint: branch.model_hint,
      visibility: branch.visibility,
      expected_output: branch.expected_output ?? [],
      acceptance: branch.acceptance ?? []
    };
  });

  return {
    valid: true,
    issues: [],
    taskTree,
    branches,
    ready_branches: branches.filter((branch) => branch.status === "ready").map((branch) => branch.branch_id),
    waiting_branches: branches
      .filter((branch) => branch.status === "waiting_on_dependencies")
      .map((branch) => branch.branch_id)
  };
}

export function resolveQueueDir(root, config = {}) {
  return path.resolve(root, config.queueDir ?? path.join("shared", "runtime", "queue"));
}

export async function writeTaskTreeSnapshot(root, taskTree, config = {}) {
  const queueDir = resolveQueueDir(root, config);
  await fsp.mkdir(queueDir, { recursive: true });
  const queuePath = path.join(queueDir, `${taskTree.task_id}.json`);
  await fsp.writeFile(queuePath, `${JSON.stringify(taskTree, null, 2)}\n`, "utf8");
  return queuePath;
}

export function resolveDispatchDirs(root, config = {}) {
  return {
    dispatchDir: path.resolve(root, config.dispatchDir ?? path.join("shared", "runtime", "dispatch")),
    activityDir: path.resolve(root, config.activityDir ?? path.join("shared", "runtime", "activity"))
  };
}

function taskDispatchDir(root, taskId, config = {}) {
  const { dispatchDir } = resolveDispatchDirs(root, config);
  return path.join(dispatchDir, taskId);
}

export function branchPacketPath(root, taskId, branchId, config = {}) {
  return path.join(taskDispatchDir(root, taskId, config), `${branchId}.json`);
}

export function branchResultPath(root, taskId, branchId, config = {}) {
  return path.join(taskDispatchDir(root, taskId, config), `${branchId}.result.json`);
}

export function branchMarkdownResultPath(root, taskId, branchId, config = {}) {
  return path.join(taskDispatchDir(root, taskId, config), `${branchId}.result.md`);
}

export function branchValidationPath(root, taskId, branchId, config = {}) {
  return path.join(taskDispatchDir(root, taskId, config), `${branchId}.validation.json`);
}

async function resetBranchRuntimeArtifacts(root, taskId, branchId, config = {}) {
  const staleArtifacts = [
    branchMarkdownResultPath(root, taskId, branchId, config),
    branchResultPath(root, taskId, branchId, config),
    branchValidationPath(root, taskId, branchId, config)
  ];

  await Promise.all(
    staleArtifacts.map(async (candidate) => {
      if (fs.existsSync(candidate)) {
        await fsp.rm(candidate, { force: true });
      }
    })
  );
}

export function resolveBoardDirs(root, config = {}) {
  return {
    hotDir: path.resolve(root, config.hotDir ?? path.join("shared", "blackboard", "hot")),
    archiveDir: path.resolve(root, config.archiveDir ?? path.join("shared", "blackboard", "archive"))
  };
}

export function cardPath(dir, taskId) {
  return path.join(dir, `${taskId}.md`);
}

function summarizeBranchLine(branch) {
  return `- [${branch.status}] ${branch.branch_id} | owner=${branch.owner} | route=${branch.route} | tool_mode=${branch.tool_mode} | model=${branch.model_hint}`;
}

function relativePathOrAbsolute(root, targetPath) {
  if (!targetPath) return null;
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(root, absoluteTarget);
  return relative && !relative.startsWith("..") ? relative : absoluteTarget;
}

function ownerWorkspacePath(root, owner) {
  return path.join(root, `workspace-${owner}`);
}

function safeExecutionSessionId(taskTree, branch) {
  return [
    "run",
    slugify(branch.owner, "agent"),
    slugify(taskTree.task_id, "task"),
    slugify(branch.branch_id, "branch")
  ].join("-");
}

function branchSessionKey(taskTree, branch) {
  return `agent:${branch.owner}:management:${taskTree.task_id}:${branch.branch_id}`;
}

function buildRouteNote(branch) {
  if (branch.route !== "strategy_review") return null;
  return `${branch.branch_id} uses strategy_review with ${branch.model_hint} and low-tool policy`;
}

function branchStatusLine(branch, status = branch.status) {
  return `[${status}] ${branch.branch_id} | owner=${branch.owner} | route=${branch.route} | tool_mode=${branch.tool_mode} | model=${branch.model_hint}`;
}

function parseFrontmatterValue(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildBranchInstructions(packet) {
  const lines = [
    `Task: ${packet.title}`,
    `Branch: ${packet.branch.branch_id}`,
    `Owner: ${packet.branch.owner}`,
    `Route: ${packet.branch.route}`,
    `Tool Mode: ${packet.branch.tool_mode}`,
    `Preferred Model: ${packet.branch.model_hint}`,
    "",
    "Goal:",
    `- ${packet.branch.goal}`,
    "",
    "Expected Output:",
    ...packet.output_contract.expected_output.map((item) => `- ${item}`),
    "",
    "Acceptance:",
    ...packet.output_contract.acceptance.map((item) => `- ${item}`),
    "",
    "Required Shared Files:",
    `- task_tree: ${packet.inputs.task_tree_path}`,
    `- blackboard: ${packet.inputs.blackboard_card_path ?? "not_created_yet"}`,
    `- activity_log: ${packet.transparency.activity_log_path}`,
    "",
    "Execution Rules:",
    "- Execute only this branch. Do not absorb sibling branches.",
    "- Update blackboard after meaningful state changes.",
    "- Record outputs, blockers, and next step in a transparent way.",
    "- Do not self-validate. Hand back to validator when output is ready."
  ];

  if (packet.branch.route === "strategy_review") {
    lines.push(
      "- This is a low-tool reasoning branch. If you discover a need for web, file, code, or device actions, stop and ask main to split a new default branch."
    );
  }

  return lines.join("\n");
}

function buildBranchPacket(root, taskTree, branch, context = {}) {
  const createdAt = new Date().toISOString();
  const packetPath = context.packetPath;
  const absolutePacketPath = path.resolve(packetPath);
  const absoluteQueuePath = context.queuePath ? path.resolve(context.queuePath) : null;
  const absoluteBoardPath = context.boardPath ? path.resolve(context.boardPath) : null;
  const absoluteActivityLogPath = context.activityLogPath ? path.resolve(context.activityLogPath) : null;
  const workspacePath = ownerWorkspacePath(root, branch.owner);
  const sessionKey = branchSessionKey(taskTree, branch);

  const packet = {
    version: "management-handoff-v1",
    created_at: createdAt,
    task_id: taskTree.task_id,
    title: taskTree.title,
    branch: {
      branch_id: branch.branch_id,
      owner: branch.owner,
      goal: branch.goal,
      depends_on: branch.depends_on ?? [],
      route: branch.route,
      tool_mode: branch.tool_mode,
      model_hint: branch.model_hint,
      visibility: branch.visibility
    },
    inputs: {
      task_tree_path: absoluteQueuePath,
      blackboard_card_path: absoluteBoardPath,
      dependencies: branch.depends_on ?? []
    },
    execution: {
      workspace_path: workspacePath,
      session_key: sessionKey,
      session_id: safeExecutionSessionId(taskTree, branch),
      preferred_model: branch.model_hint,
      recommended_invocation: {
        command: "openclaw agent",
        args: [
          "--agent",
          branch.owner,
          "--local",
          "--json",
          "--session-id",
          safeExecutionSessionId(taskTree, branch),
          "--message",
          `Read branch packet at ${absolutePacketPath}. Execute only branch ${branch.branch_id}, update blackboard, and return a structured branch result.`
        ]
      }
    },
    output_contract: {
      expected_output: branch.expected_output ?? [],
      acceptance: branch.acceptance ?? [],
      must_update_blackboard: true,
      must_not_self_validate: true
    },
    transparency: {
      visibility: branch.visibility,
      packet_path: absolutePacketPath,
      activity_log_path: absoluteActivityLogPath
    }
  };

  packet.instructions = buildBranchInstructions(packet);
  return packet;
}

export async function appendActivityLog(root, taskId, event, config = {}) {
  const { activityDir } = resolveDispatchDirs(root, config);
  await fsp.mkdir(activityDir, { recursive: true });
  const activityLogPath = path.join(activityDir, `${taskId}.jsonl`);
  const line = {
    timestamp: new Date().toISOString(),
    task_id: taskId,
    ...event
  };
  await fsp.appendFile(activityLogPath, `${JSON.stringify(line)}\n`, "utf8");
  return activityLogPath;
}

export function deriveBranchStates(root, taskTreeInput, overrides = {}, config = {}) {
  const dispatchState = computeDispatchState(taskTreeInput);
  if (!dispatchState.valid) {
    return dispatchState;
  }

  const { dispatchDir } = resolveDispatchDirs(root, config);
  const taskDispatchDir = path.join(dispatchDir, dispatchState.taskTree.task_id);
  const branches = dispatchState.branches.map((branch) => {
    const packetPath = path.join(taskDispatchDir, `${branch.branch_id}.json`);
    const packetExists = fs.existsSync(packetPath);
    let status = branch.status;
    if (status === "ready" && packetExists) {
      status = "assigned";
    }
    if (overrides[branch.branch_id]) {
      status = overrides[branch.branch_id];
    }
    return {
      ...branch,
      status
    };
  });

  return {
    ...dispatchState,
    branches,
    branch_status_lines: branches.map((branch) => branchStatusLine(branch, branch.status))
  };
}

export async function readBoardState(root, taskId, config = {}) {
  const { hotDir } = resolveBoardDirs(root, config);
  const boardPath = cardPath(hotDir, taskId);
  if (!fs.existsSync(boardPath)) {
    return {
      board_path: null,
      frontmatter: {},
      retry_count: {}
    };
  }

  const markdown = await fsp.readFile(boardPath, "utf8");
  const { frontmatter } = parseFrontmatter(markdown);
  const parsed = Object.fromEntries(
    Array.from(frontmatter.entries()).map(([key, value]) => [key, parseFrontmatterValue(value)])
  );

  return {
    board_path: boardPath,
    frontmatter: parsed,
    retry_count:
      parsed.retry_count && typeof parsed.retry_count === "object" && !Array.isArray(parsed.retry_count)
        ? parsed.retry_count
        : {}
  };
}

export async function deriveRuntimeBranchStates(root, taskTreeInput, overrides = {}, config = {}) {
  const { valid, issues, taskTree } = validateTaskTree(taskTreeInput);
  if (!valid) {
    return {
      valid,
      issues,
      taskTree
    };
  }

  const boardState = await readBoardState(root, taskTree.task_id, config);
  const retryCount = config.retryCountOverride ?? boardState.retry_count ?? {};
  const maxRetries = Number(taskTree.retry_policy?.max_retries ?? 3);
  const branchMap = new Map(taskTree.branches.map((branch) => [branch.branch_id, branch]));
  const artifacts = new Map();

  await Promise.all(
    taskTree.branches.map(async (branch) => {
      const packetPath = branchPacketPath(root, taskTree.task_id, branch.branch_id, config);
      const resultPath = branchResultPath(root, taskTree.task_id, branch.branch_id, config);
      const validationPath = branchValidationPath(root, taskTree.task_id, branch.branch_id, config);

      let resultPayload = null;
      let validationPayload = null;
      if (fs.existsSync(resultPath)) {
        resultPayload = JSON.parse(await fsp.readFile(resultPath, "utf8"));
      }
      if (fs.existsSync(validationPath)) {
        validationPayload = JSON.parse(await fsp.readFile(validationPath, "utf8"));
      }

      artifacts.set(branch.branch_id, {
        packet_path: packetPath,
        packet_exists: fs.existsSync(packetPath),
        result_path: resultPath,
        result_exists: Boolean(resultPayload),
        result_payload: resultPayload,
        validation_path: validationPath,
        validation_exists: Boolean(validationPayload),
        validation_payload: validationPayload,
        retry_count: Number(retryCount[branch.branch_id] ?? 0)
      });
    })
  );

  const memo = new Map();
  function statusFor(branchId) {
    if (memo.has(branchId)) return memo.get(branchId);
    const branch = branchMap.get(branchId);
    const artifact = artifacts.get(branchId) ?? {};

    let status;
    const validationStatus = String(artifact.validation_payload?.validation?.status ?? artifact.validation_payload?.status ?? "")
      .trim()
      .toUpperCase();
    if (validationStatus === "PASS") {
      status = "done";
    } else if (validationStatus === "BLOCK") {
      status = "blocked";
    } else if (validationStatus === "FAIL") {
      status = artifact.retry_count >= maxRetries ? "blocked" : "ready";
    } else if (artifact.result_exists) {
      const executionOk =
        artifact.result_payload?.execution?.ok ??
        artifact.result_payload?.ok ??
        artifact.result_payload?.status === "completed_pending_validation";
      status = executionOk ? "completed_pending_validation" : artifact.retry_count >= maxRetries ? "blocked" : "ready";
    } else if (artifact.packet_exists) {
      status = "assigned";
    } else {
      const dependencyStatuses = (branch?.depends_on ?? []).map((depId) => statusFor(depId));
      if (dependencyStatuses.some((depStatus) => depStatus === "blocked")) {
        status = "blocked";
      } else if ((branch?.depends_on ?? []).length === 0 || dependencyStatuses.every((depStatus) => depStatus === "done")) {
        status = "ready";
      } else {
        status = "waiting_on_dependencies";
      }
    }

    if (overrides[branchId]) {
      status = overrides[branchId];
    }
    memo.set(branchId, status);
    return status;
  }

  const branches = taskTree.branches.map((branch) => {
    const artifact = artifacts.get(branch.branch_id) ?? {};
    return {
      branch_id: branch.branch_id,
      owner: branch.owner,
      goal: branch.goal,
      status: statusFor(branch.branch_id),
      depends_on: branch.depends_on ?? [],
      route: branch.route,
      tool_mode: branch.tool_mode,
      model_hint: branch.model_hint,
      visibility: branch.visibility,
      expected_output: branch.expected_output ?? [],
      acceptance: branch.acceptance ?? [],
      retry_count: artifact.retry_count ?? 0,
      packet_path: artifact.packet_exists ? relativePathOrAbsolute(root, artifact.packet_path) : null,
      result_path: artifact.result_exists ? relativePathOrAbsolute(root, artifact.result_path) : null,
      validation_path: artifact.validation_exists ? relativePathOrAbsolute(root, artifact.validation_path) : null
    };
  });

  return {
    valid: true,
    issues: [],
    taskTree,
    board_path: boardState.board_path ? relativePathOrAbsolute(root, boardState.board_path) : null,
    retry_count: retryCount,
    branches,
    ready_branches: branches
      .filter((branch) => branch.status === "ready")
      .map((branch) => branch.branch_id),
    waiting_branches: branches
      .filter((branch) => branch.status === "waiting_on_dependencies")
      .map((branch) => branch.branch_id),
    blocked_branches: branches
      .filter((branch) => branch.status === "blocked")
      .map((branch) => branch.branch_id),
    completed_branches: branches
      .filter((branch) => branch.status === "done")
      .map((branch) => branch.branch_id),
    branch_status_lines: branches.map((branch) => branchStatusLine(branch, branch.status))
  };
}

export async function handoffReadyBranches(root, taskTreeInput, config = {}) {
  const dispatchState = await deriveRuntimeBranchStates(root, taskTreeInput, {}, config);
  if (!dispatchState.valid) {
    return dispatchState;
  }

  const { taskTree } = dispatchState;
  const { dispatchDir, activityDir } = resolveDispatchDirs(root, config);
  const currentTaskDispatchDir = path.join(dispatchDir, taskTree.task_id);
  await fsp.mkdir(currentTaskDispatchDir, { recursive: true });
  await fsp.mkdir(activityDir, { recursive: true });

  const { hotDir } = resolveBoardDirs(root, config);
  const boardPath = cardPath(hotDir, taskTree.task_id);
  const hasBoardCard = fs.existsSync(boardPath);
  const queuePath =
    config.queuePath && fs.existsSync(path.resolve(config.queuePath))
      ? path.resolve(config.queuePath)
      : await writeTaskTreeSnapshot(root, taskTree, config);
  const activityLogPath = path.join(activityDir, `${taskTree.task_id}.jsonl`);
  const memoryConfig = managementMemoryDefaults(root);
  const memoryStatus = {
    task_tree: null,
    branch_packets: [],
    activity_events: []
  };

  if (memoryConfig.syncTaskTreeToWorking) {
    memoryStatus.task_tree = await syncManagementRecord(root, {
      kind: "task_tree",
      task_id: taskTree.task_id,
      title: taskTree.title,
      summary: `Task Tree created for ${taskTree.title}`,
      detail: JSON.stringify(taskTree, null, 2),
      session_id: managementWorkingSessionId(taskTree.task_id),
      tags: ["management", "task-tree"],
      sync_semantic_graph: false
    }).catch((error) => ({
      status: "error",
      error: error.message
    }));
  } else {
    memoryStatus.task_tree = { status: "skipped" };
  }

  const packets = [];
  for (const branchId of dispatchState.ready_branches) {
    const branch = taskTree.branches.find((item) => item.branch_id === branchId);
    if (!branch) continue;

    await resetBranchRuntimeArtifacts(root, taskTree.task_id, branch.branch_id, config);

    const packetPath = branchPacketPath(root, taskTree.task_id, branch.branch_id, config);
    const packet = buildBranchPacket(root, taskTree, branch, {
      packetPath,
      queuePath,
      boardPath: hasBoardCard ? boardPath : null,
      activityLogPath
    });
    await fsp.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

    await appendActivityLog(
      root,
      taskTree.task_id,
      {
        branch_id: branch.branch_id,
        owner: branch.owner,
        route: branch.route,
        tool_mode: branch.tool_mode,
        model_hint: branch.model_hint,
        event: "branch_assigned",
        status: "assigned",
        packet_path: relativePathOrAbsolute(root, packetPath)
      },
      config
    );

    if (memoryConfig.syncBranchPacketToWorking) {
      memoryStatus.branch_packets.push(
        await syncManagementRecord(root, {
          kind: "branch_packet",
          task_id: taskTree.task_id,
          branch_id: branch.branch_id,
          owner: branch.owner,
          route: branch.route,
          tool_mode: branch.tool_mode,
          model_hint: branch.model_hint,
          title: taskTree.title,
          summary: `Branch packet assigned to ${branch.owner} for ${branch.branch_id}`,
          detail: packet.instructions,
          session_id: managementWorkingSessionId(taskTree.task_id, branch.branch_id),
          tags: ["management", "branch-packet", branch.owner, branch.route],
          sync_semantic_graph:
            branch.route === "strategy_review" && memoryConfig.syncStrategyReviewToSemanticGraph
        }).catch((error) => ({
          status: "error",
          branch_id: branch.branch_id,
          error: error.message
        }))
      );
    } else {
      memoryStatus.branch_packets.push({ status: "skipped", branch_id: branch.branch_id });
    }

    if (memoryConfig.syncActivityToWorking) {
      memoryStatus.activity_events.push(
        await syncManagementRecord(root, {
          kind: "activity_event",
          task_id: taskTree.task_id,
          branch_id: branch.branch_id,
          owner: branch.owner,
          route: branch.route,
          tool_mode: branch.tool_mode,
          model_hint: branch.model_hint,
          title: taskTree.title,
          summary: `Branch ${branch.branch_id} assigned to ${branch.owner}`,
          detail: `packet_path=${relativePathOrAbsolute(root, packetPath)}\nactivity_log=${relativePathOrAbsolute(root, activityLogPath)}`,
          session_id: managementWorkingSessionId(taskTree.task_id, branch.branch_id),
          tags: ["management", "activity", "branch-assigned", branch.owner],
          sync_semantic_graph: false
        }).catch((error) => ({
          status: "error",
          branch_id: branch.branch_id,
          error: error.message
        }))
      );
    } else {
      memoryStatus.activity_events.push({ status: "skipped", branch_id: branch.branch_id });
    }

    packets.push({
      branch_id: branch.branch_id,
      owner: branch.owner,
      route: branch.route,
      tool_mode: branch.tool_mode,
      model_hint: branch.model_hint,
      visibility: branch.visibility,
      packet_path: relativePathOrAbsolute(root, packetPath),
      session_key: packet.execution.session_key,
      session_id: packet.execution.session_id,
      workspace_path: packet.execution.workspace_path,
      recommended_invocation: packet.execution.recommended_invocation
    });
  }

  if (hasBoardCard) {
    const derived = await deriveRuntimeBranchStates(
      root,
      taskTree,
      Object.fromEntries(packets.map((packet) => [packet.branch_id, "assigned"])),
      config
    );
    const routeNotes = derived.branches
      .map((branch) => buildRouteNote(branch))
      .filter(Boolean);

    await writeBoardUpdate(
      root,
      {
        task_id: taskTree.task_id,
        status: packets.length > 0 ? "in_progress" : "pending",
        current_branch: packets[0]?.branch_id ?? dispatchState.ready_branches[0] ?? "main",
        branch_status: derived.branch_status_lines,
        last_action:
          packets.length > 0
            ? `Assigned ready branches: ${packets.map((packet) => packet.branch_id).join(", ")}`
            : "No ready branches were available for handoff.",
        current_outputs: [
          `task tree snapshot: ${relativePathOrAbsolute(root, queuePath)}`,
          ...packets.map((packet) => `branch packet: ${packet.packet_path}`)
        ],
        next_step:
          packets.length > 0
            ? `run assigned branches: ${packets.map((packet) => packet.branch_id).join(", ")}`
            : "wait for dependency resolution",
        route_notes: routeNotes
      },
      config
    );
  }

  return {
    valid: true,
    task_id: taskTree.task_id,
    title: taskTree.title,
    status: packets.length > 0 ? "handed_off" : "idle",
    queue_path: relativePathOrAbsolute(root, queuePath),
    dispatch_dir: relativePathOrAbsolute(root, currentTaskDispatchDir),
    activity_log_path: relativePathOrAbsolute(root, activityLogPath),
    card_path: hasBoardCard ? relativePathOrAbsolute(root, boardPath) : null,
    memory_status: memoryStatus,
    handoff_count: packets.length,
    ready_branches: dispatchState.ready_branches,
    waiting_branches: dispatchState.waiting_branches,
    packets
  };
}

export function buildBoardCard(taskTreeInput) {
  const dispatch = computeDispatchState(taskTreeInput);
  const taskTree = dispatch.taskTree;
  const now = new Date().toISOString();
  const branchLines = dispatch.branches.map((branch) => summarizeBranchLine(branch));
  return [
    "---",
    `task_id: ${taskTree.task_id}`,
    `title: ${taskTree.title}`,
    "owner: main",
    "status: pending",
    "priority: normal",
    `created_at: ${now}`,
    `updated_at: ${now}`,
    `current_branch: ${dispatch.ready_branches[0] ?? "main"}`,
    "retry_count: {}",
    `approval_required: ${taskTree.approval_mode !== "none"}`,
    "blocker: null",
    `related_files: ["shared/runtime/queue/${taskTree.task_id}.json"]`,
    "---",
    "",
    "# Goal",
    taskTree.title,
    "",
    "# Branch Status",
    branchLines.length > 0 ? branchLines.join("\n") : "- [pending] no branches yet",
    "",
    "# Last Action",
    "Initialized blackboard card.",
    "",
    "# Current Outputs",
    "- task tree created",
    "",
    "# Next Step",
    dispatch.ready_branches.length > 0
      ? `- dispatch ready branches: ${dispatch.ready_branches.join(", ")}`
      : "- wait for dependency resolution",
    "",
    "# Risk / Blocker",
    "- none",
    "",
    "# Route Notes",
    dispatch.branches
      .filter((branch) => branch.route === "strategy_review")
      .map(
        (branch) =>
          `- ${branch.branch_id} uses strategy_review route with ${branch.model_hint} and low-tool policy`
      )
      .join("\n") || "- none"
  ].join("\n");
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: new Map(), body: markdown };
  }

  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: new Map(), body: markdown };

  const raw = markdown.slice(4, end).split("\n");
  const frontmatter = new Map();
  for (const line of raw) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontmatter.set(key, value);
  }
  return {
    frontmatter,
    body: markdown.slice(end + 5).trimStart()
  };
}

function parseSections(body) {
  const lines = body.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (current) sections.push(current);
      current = {
        title: line.slice(2).trim(),
        lines: []
      };
      continue;
    }

    if (!current) {
      current = { title: "", lines: [] };
    }
    current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function serializeMarkdown(frontmatter, sections) {
  const frontmatterLines = ["---"];
  for (const [key, value] of frontmatter.entries()) {
    frontmatterLines.push(`${key}: ${value}`);
  }
  frontmatterLines.push("---", "");

  const body = sections
    .filter((section) => section.title)
    .map((section) => `# ${section.title}\n${section.lines.join("\n").trimEnd()}`.trimEnd())
    .join("\n\n");

  return `${frontmatterLines.join("\n")}${body}\n`;
}

function setFrontmatterValue(frontmatter, key, value) {
  if (typeof value === "string") {
    frontmatter.set(key, value);
    return;
  }
  frontmatter.set(key, stableStringify(value));
}

function setSection(sections, title, content) {
  const normalizedContent = Array.isArray(content)
    ? content.join("\n")
    : String(content ?? "").trim();
  const lines = normalizedContent ? normalizedContent.split("\n") : ["- none"];
  const existing = sections.find((section) => section.title === title);
  if (existing) {
    existing.lines = lines;
    return;
  }
  sections.push({ title, lines });
}

export function updateBoardMarkdown(markdown, payload = {}) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const sections = parseSections(body).filter((section) => section.title);

  setFrontmatterValue(frontmatter, "status", payload.status ?? "pending");
  setFrontmatterValue(frontmatter, "updated_at", new Date().toISOString());
  setFrontmatterValue(frontmatter, "current_branch", payload.current_branch ?? "main");
  setFrontmatterValue(frontmatter, "blocker", payload.blocker ?? "null");
  if (Object.prototype.hasOwnProperty.call(payload, "retry_count")) {
    setFrontmatterValue(frontmatter, "retry_count", payload.retry_count ?? {});
  }

  if (Array.isArray(payload.branch_status) && payload.branch_status.length > 0) {
    setSection(sections, "Branch Status", payload.branch_status.map((item) => `- ${item}`));
  }
  setSection(sections, "Last Action", payload.last_action ?? "- updated");
  setSection(
    sections,
    "Current Outputs",
    Array.isArray(payload.current_outputs)
      ? payload.current_outputs.map((item) => `- ${item}`)
      : payload.current_outputs ?? "- none"
  );
  setSection(sections, "Next Step", payload.next_step ?? "- continue");
  setSection(
    sections,
    "Risk / Blocker",
    payload.blocker ? `- ${payload.blocker}` : "- none"
  );
  if (payload.route_notes) {
    setSection(
      sections,
      "Route Notes",
      Array.isArray(payload.route_notes)
        ? payload.route_notes.map((item) => `- ${item}`)
        : payload.route_notes
    );
  }

  return serializeMarkdown(frontmatter, sections);
}

export async function writeBoardInit(root, taskTree, config = {}) {
  const { hotDir } = resolveBoardDirs(root, config);
  await fsp.mkdir(hotDir, { recursive: true });
  const target = cardPath(hotDir, taskTree.task_id);
  await fsp.writeFile(target, `${buildBoardCard(taskTree)}\n`, "utf8");
  return target;
}

export async function writeBoardUpdate(root, payload, config = {}) {
  const { hotDir } = resolveBoardDirs(root, config);
  const target = cardPath(hotDir, payload.task_id);
  const markdown = await fsp.readFile(target, "utf8");
  const updated = updateBoardMarkdown(markdown, payload);
  await fsp.writeFile(target, updated, "utf8");
  return target;
}

function extractSectionText(markdown, sectionTitle) {
  const { body } = parseFrontmatter(markdown);
  const sections = parseSections(body);
  const section = sections.find((item) => item.title === sectionTitle);
  return section ? section.lines.join("\n").trim() : "";
}

export async function finalizeBoardCard(root, payload, config = {}) {
  const { hotDir, archiveDir } = resolveBoardDirs(root, config);
  await fsp.mkdir(archiveDir, { recursive: true });

  const hotPath = cardPath(hotDir, payload.task_id);
  const archivePath = cardPath(archiveDir, payload.task_id);
  const markdown = await fsp.readFile(hotPath, "utf8");
  await fsp.writeFile(archivePath, markdown, "utf8");

  const summary =
    payload.summary ??
    extractSectionText(markdown, "Last Action") ??
    "task archived";
  const outputs =
    payload.output_paths ??
    extractSectionText(markdown, "Current Outputs")
      .split("\n")
      .map((line) => line.replace(/^- /, "").trim())
      .filter(Boolean);

  const summaryCard = [
    "---",
    `task_id: ${payload.task_id}`,
    `title: ${payload.title ?? payload.task_id}`,
    "owner: main",
    "status: archived",
    `updated_at: ${new Date().toISOString()}`,
    `archive_path: ${archivePath}`,
    "---",
    "",
    "# Summary",
    `- ${summary}`,
    "",
    "# Output Paths",
    ...(outputs.length > 0 ? outputs.map((item) => `- ${item}`) : ["- none"]),
    "",
    "# Archive",
    `- full_record: ${archivePath}`
  ].join("\n");

  await fsp.writeFile(hotPath, `${summaryCard}\n`, "utf8");
  return {
    hot_path: hotPath,
    archive_path: archivePath
  };
}
