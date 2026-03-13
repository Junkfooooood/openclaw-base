import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

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
  const relativePacketPath = relativePathOrAbsolute(root, packetPath);
  const relativeQueuePath = relativePathOrAbsolute(root, context.queuePath);
  const relativeBoardPath = relativePathOrAbsolute(root, context.boardPath);
  const relativeActivityLogPath = relativePathOrAbsolute(root, context.activityLogPath);
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
      task_tree_path: relativeQueuePath,
      blackboard_card_path: relativeBoardPath,
      dependencies: branch.depends_on ?? []
    },
    execution: {
      workspace_path: workspacePath,
      session_key: sessionKey,
      preferred_model: branch.model_hint,
      recommended_invocation: {
        command: "openclaw agent",
        args: [
          "--agent",
          branch.owner,
          "--local",
          "--json",
          "--session-id",
          sessionKey,
          "--message",
          `Read branch packet at ${relativePacketPath}. Execute only branch ${branch.branch_id}, update blackboard, and return a structured branch result.`
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
      packet_path: relativePacketPath,
      activity_log_path: relativeActivityLogPath
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

export async function handoffReadyBranches(root, taskTreeInput, config = {}) {
  const dispatchState = computeDispatchState(taskTreeInput);
  if (!dispatchState.valid) {
    return dispatchState;
  }

  const { taskTree } = dispatchState;
  const { dispatchDir, activityDir } = resolveDispatchDirs(root, config);
  const taskDispatchDir = path.join(dispatchDir, taskTree.task_id);
  await fsp.mkdir(taskDispatchDir, { recursive: true });
  await fsp.mkdir(activityDir, { recursive: true });

  const { hotDir } = resolveBoardDirs(root, config);
  const boardPath = cardPath(hotDir, taskTree.task_id);
  const hasBoardCard = fs.existsSync(boardPath);
  const queuePath =
    config.queuePath && fs.existsSync(path.resolve(config.queuePath))
      ? path.resolve(config.queuePath)
      : await writeTaskTreeSnapshot(root, taskTree, config);
  const activityLogPath = path.join(activityDir, `${taskTree.task_id}.jsonl`);

  const packets = [];
  for (const branchId of dispatchState.ready_branches) {
    const branch = taskTree.branches.find((item) => item.branch_id === branchId);
    if (!branch) continue;

    const packetPath = path.join(taskDispatchDir, `${branch.branch_id}.json`);
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

    packets.push({
      branch_id: branch.branch_id,
      owner: branch.owner,
      route: branch.route,
      tool_mode: branch.tool_mode,
      model_hint: branch.model_hint,
      visibility: branch.visibility,
      packet_path: relativePathOrAbsolute(root, packetPath),
      session_key: packet.execution.session_key,
      workspace_path: packet.execution.workspace_path,
      recommended_invocation: packet.execution.recommended_invocation
    });
  }

  if (hasBoardCard) {
    const assignedSet = new Set(packets.map((packet) => packet.branch_id));
    const branchStatus = dispatchState.branches.map((branch) =>
      branchStatusLine(branch, assignedSet.has(branch.branch_id) ? "assigned" : branch.status)
    );
    const routeNotes = dispatchState.branches
      .map((branch) => buildRouteNote(branch))
      .filter(Boolean);

    await writeBoardUpdate(
      root,
      {
        task_id: taskTree.task_id,
        status: packets.length > 0 ? "in_progress" : "pending",
        current_branch: packets[0]?.branch_id ?? dispatchState.ready_branches[0] ?? "main",
        branch_status: branchStatus,
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
    dispatch_dir: relativePathOrAbsolute(root, taskDispatchDir),
    activity_log_path: relativePathOrAbsolute(root, activityLogPath),
    card_path: hasBoardCard ? relativePathOrAbsolute(root, boardPath) : null,
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
  setFrontmatterValue(frontmatter, "retry_count", payload.retry_count ?? {});

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
