import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import {
  KNOWN_EXECUTION_ROUTES,
  KNOWN_TOOL_MODES,
  computeDispatchState,
  findProjectRoot,
  handoffReadyBranches,
  readJsonFromStdin,
  validateTaskTree,
  writeTaskTreeSnapshot
} from "../../shared/runtime/management/task_dispatch_lib.mjs";
import { executeReadyBranches } from "../../shared/runtime/management/branch_execution_lib.mjs";

const KNOWN_ROUTES = new Set([
  "logs",
  "knowledge",
  "taskboard",
  "capabilities",
  "reputation",
  "strategy"
]);

const KNOWN_ROUTE_ALIASES = new Map([
  ["log", "logs"],
  ["logs", "logs"],
  ["journal", "logs"],
  ["日志", "logs"],
  ["日志板块", "logs"],
  ["knowledge", "knowledge"],
  ["kb", "knowledge"],
  ["知识", "knowledge"],
  ["知识库", "knowledge"],
  ["task", "taskboard"],
  ["tasks", "taskboard"],
  ["taskboard", "taskboard"],
  ["任务", "taskboard"],
  ["任务板块", "taskboard"],
  ["任务看板", "taskboard"],
  ["capability", "capabilities"],
  ["capabilities", "capabilities"],
  ["能力", "capabilities"],
  ["六维能力", "capabilities"],
  ["六维能力记录", "capabilities"],
  ["reputation", "reputation"],
  ["声望", "reputation"],
  ["声望榜单", "reputation"],
  ["strategy", "strategy"],
  ["战略", "strategy"],
  ["战略板块", "strategy"]
]);

const KNOWN_OUTPUT_TYPES = new Set(["draft", "patch", "suggestion"]);

function parseJsonMaybe(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasBlockedBranch(retryCountMap = {}, maxRetries = 3) {
  for (const key of Object.keys(retryCountMap)) {
    if ((retryCountMap[key] ?? 0) >= maxRetries) return true;
  }
  return false;
}

function isProtectedWrite(writePath, protectedPaths = []) {
  if (!writePath || !Array.isArray(protectedPaths) || protectedPaths.length === 0) {
    return false;
  }

  const normalizedWritePath = path.resolve(writePath);
  return protectedPaths.some((candidate) => {
    const normalizedCandidate = path.resolve(candidate);
    return (
      normalizedWritePath === normalizedCandidate ||
      normalizedWritePath.startsWith(`${normalizedCandidate}${path.sep}`)
    );
  });
}

function normalizeRouteName(route) {
  const normalized = String(route ?? "").trim().toLowerCase();
  return KNOWN_ROUTE_ALIASES.get(normalized) ?? normalized;
}

function validateRoutePlan(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      status: "BLOCK",
      reason: "route review payload is missing or invalid",
      failed_checks: ["payload is missing or invalid"],
      advisories: [],
      suggested_next_step: "provide_valid_route_review_payload",
      task_id: null
    };
  }

  const routePlan = payload.route_plan;
  const failedChecks = [];
  const advisories = [];
  const seenRoutes = new Map();

  if (!Array.isArray(routePlan) || routePlan.length === 0) {
    return {
      status: "BLOCK",
      reason: "route_plan is missing or empty",
      failed_checks: ["route_plan must be a non-empty array"],
      advisories: [],
      suggested_next_step: "provide_route_plan",
      task_id: payload.task_id ?? null
    };
  }

  const normalizedPlan = routePlan.map((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failedChecks.push(`route_plan[${idx}] must be an object`);
      return null;
    }

    const normalizedRoute = normalizeRouteName(item.route);
    if (!item.route) {
      failedChecks.push(`route_plan[${idx}].route is required`);
    } else if (!KNOWN_ROUTES.has(normalizedRoute)) {
      failedChecks.push(`route_plan[${idx}].route '${item.route}' is not a known route`);
    }

    if (!item.why || !String(item.why).trim()) {
      failedChecks.push(`route_plan[${idx}].why is required`);
    }

    if (!item.output_type || !String(item.output_type).trim()) {
      failedChecks.push(`route_plan[${idx}].output_type is required`);
    } else if (!KNOWN_OUTPUT_TYPES.has(String(item.output_type).trim().toLowerCase())) {
      failedChecks.push(
        `route_plan[${idx}].output_type '${item.output_type}' must be one of: ${Array.from(KNOWN_OUTPUT_TYPES).join(", ")}`
      );
    }

    if (item.confidence != null) {
      const confidence = Number(item.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        failedChecks.push(`route_plan[${idx}].confidence must be between 0 and 1`);
      }
    }

    if (KNOWN_ROUTES.has(normalizedRoute)) {
      seenRoutes.set(normalizedRoute, (seenRoutes.get(normalizedRoute) ?? 0) + 1);
    }

    return {
      route: normalizedRoute,
      why: String(item.why ?? "").trim(),
      output_type: String(item.output_type ?? "").trim().toLowerCase(),
      confidence: item.confidence ?? null
    };
  });

  for (const [route, count] of seenRoutes.entries()) {
    if (count > 1) {
      advisories.push(`route '${route}' appears ${count} times; consider merging or clarifying the split`);
    }
  }

  const hasLogs = normalizedPlan.some((item) => item?.route === "logs");
  if (!hasLogs) {
    advisories.push("consider adding logs if this conversation should be archived in the learning system");
  }

  if (!payload.source_summary || !String(payload.source_summary).trim()) {
    advisories.push("source_summary is missing; route review is still possible but less comparable over time");
  }

  if (failedChecks.length > 0) {
    return {
      status: "FAIL",
      reason: "route plan failed lightweight review",
      failed_checks: failedChecks,
      advisories,
      suggested_next_step: "revise_route_plan",
      task_id: payload.task_id ?? null,
      normalized_route_plan: normalizedPlan.filter(Boolean)
    };
  }

  return {
    status: "PASS",
    reason: "route plan is structurally valid and broadly reasonable",
    failed_checks: [],
    advisories,
    suggested_next_step: "continue",
    task_id: payload.task_id ?? null,
    normalized_route_plan: normalizedPlan.filter(Boolean)
  };
}

function validateWorkflowPayload(payload) {
  const blocked = payload?.status === "blocked";
  const failReasons = [];

  if (!payload || typeof payload !== "object") {
    failReasons.push("payload is missing or invalid");
  }
  if (!payload.task_id) {
    failReasons.push("task_id is required");
  }
  if (!payload.title) {
    failReasons.push("title is required");
  }
  if (!Array.isArray(payload.branches)) {
    failReasons.push("branches must be an array");
  } else {
    payload.branches.forEach((branch, idx) => {
      if (!branch.branch_id) failReasons.push(`branches[${idx}].branch_id is required`);
      if (!branch.owner) failReasons.push(`branches[${idx}].owner is required`);
      if (!branch.status) failReasons.push(`branches[${idx}].status is required`);
      if (branch.route && !KNOWN_EXECUTION_ROUTES.has(branch.route)) {
        failReasons.push(`branches[${idx}].route '${branch.route}' is invalid`);
      }
      if (branch.tool_mode && !KNOWN_TOOL_MODES.has(branch.tool_mode)) {
        failReasons.push(`branches[${idx}].tool_mode '${branch.tool_mode}' is invalid`);
      }
      if (branch.route === "strategy_review" && branch.tool_mode !== "low_tool") {
        failReasons.push(`branches[${idx}] strategy_review must use low_tool mode`);
      }
    });
  }

  return blocked
    ? {
        status: "BLOCK",
        reason: "task is already blocked",
        failed_checks: ["blocked_state"],
        suggested_next_step: "notify_human",
        task_id: payload.task_id ?? null
      }
    : failReasons.length > 0
      ? {
          status: "FAIL",
          reason: "workflow payload failed structural validation",
          failed_checks: failReasons,
          suggested_next_step: "repair_workflow_payload",
          task_id: payload.task_id ?? null
        }
      : {
          status: "PASS",
          reason: "workflow payload passed structural validation",
          failed_checks: [],
          suggested_next_step: "continue",
          task_id: payload.task_id
        };
}

export default function register(api) {
  api.registerTool({
    name: "policy_gate_check",
    description:
      "Check task-dispatch policy before dispatch, execute, or finalize. Returns structured gate result.",
    parameters: Type.Object({
      phase: Type.Union([
        Type.Literal("pre-dispatch"),
        Type.Literal("pre-execute"),
        Type.Literal("pre-finalize")
      ]),
      isComplex: Type.Boolean(),
      taskTreeJson: Type.Optional(Type.String()),
      blackboardJson: Type.Optional(Type.String()),
      retryCountJson: Type.Optional(Type.String()),
      writePath: Type.Optional(Type.String()),
      maxRetriesPerBranch: Type.Optional(Type.Integer({ minimum: 1 }))
    }),
    async execute(_id, params) {
      const maxRetries = params.maxRetriesPerBranch ?? 3;
      const taskTree = parseJsonMaybe(params.taskTreeJson);
      const blackboard = parseJsonMaybe(params.blackboardJson);
      const retryMap = parseJsonMaybe(params.retryCountJson) ?? {};
      const protectedPaths = api.config?.protectedPaths ?? [];

      const result = {
        allowed: true,
        decision: "allow",
        nextAction: "continue",
        reasons: []
      };

      // 1. 复杂任务必须有 Task Tree
      if (params.isComplex && params.phase !== "pre-dispatch") {
        const validation = validateTaskTree(taskTree);
        if (!validation.valid) {
          result.allowed = false;
          result.decision = "deny";
          result.nextAction = "fix_task_tree";
          result.reasons.push(
            `complex task missing or invalid task tree fields: ${validation.issues.join(", ")}`
          );
        }
      }

      // 2. pre-dispatch 阶段：复杂任务没有 task tree 就要求先创建
      if (params.phase === "pre-dispatch" && params.isComplex && !taskTree) {
        result.allowed = false;
        result.decision = "need_task_tree";
        result.nextAction = "create_task_tree";
        result.reasons.push("complex task must create task tree before dispatch");
      }

      // 3. 超过最大重试次数则熔断
      if (hasBlockedBranch(retryMap, maxRetries)) {
        result.allowed = false;
        result.decision = "blocked";
        result.nextAction = "notify_human";
        result.reasons.push("at least one branch has reached retry fuse limit");
      }

      // 4. finalize 前要求黑板存在且不是 blocked
      if (params.phase === "pre-finalize") {
        if (!blackboard) {
          result.allowed = false;
          result.decision = "deny";
          result.nextAction = "write_blackboard";
          result.reasons.push("blackboard state missing before finalize");
        } else if (blackboard.status === "blocked") {
          result.allowed = false;
          result.decision = "blocked";
          result.nextAction = "notify_human";
          result.reasons.push("task is blocked; finalize is not allowed");
        }
      }

      // 5. 受保护路径写入必须先审批
      if (isProtectedWrite(params.writePath, protectedPaths)) {
        result.allowed = false;
        result.decision = "approval_required";
        result.nextAction = "request_approval";
        result.reasons.push("target write path is protected and requires approval");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  });

  api.registerTool({
    name: "policy_route_review",
    description:
      "Run a lightweight validator-style review for a route plan produced from conversation routing.",
    parameters: Type.Object({
      sourceSummary: Type.Optional(Type.String()),
      routePlanJson: Type.String(),
      taskId: Type.Optional(Type.String()),
      title: Type.Optional(Type.String())
    }),
    async execute(_id, params) {
      const routePlan = parseJsonMaybe(params.routePlanJson);
      const payload = {
        task_id: params.taskId ?? null,
        title: params.title ?? null,
        source_summary: params.sourceSummary ?? "",
        route_plan: routePlan
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(validateRoutePlan(payload), null, 2)
          }
        ]
      };
    }
  });

  api.registerCli(
    ({ program }) => {
      program
        .command("validator-run")
        .description("Run lightweight structural validation for workflow outputs.")
        .option("--kind <kind>", "Validation kind", "workflow")
        .action((opts) => {
          const payload = readJsonFromStdin();
          const result =
            opts.kind === "route-review"
              ? validateRoutePlan(payload)
              : validateWorkflowPayload(payload);

          console.log(JSON.stringify(result, null, 2));
        });

      program
        .command("task-tree-normalize")
        .description("Normalize a task tree into management-mode dispatch shape.")
        .action(() => {
          const payload = readJsonFromStdin();
          const validation = validateTaskTree(payload);
          if (!validation.valid) {
            console.log(
              JSON.stringify(
                {
                  status: "FAIL",
                  reason: "task tree is incomplete or invalid",
                  failed_checks: validation.issues,
                  suggested_next_step: "fix_task_tree"
                },
                null,
                2
              )
            );
            process.exitCode = 1;
            return;
          }

          console.log(JSON.stringify(validation.taskTree, null, 2));
        });

      const internalDispatch = program
        .command("internal-dispatch")
        .description("Persist a task tree, create branch handoff packets, and emit management summaries.");

      internalDispatch
        .command("run")
        .action(async () => {
          const taskTree = readJsonFromStdin();
          const dispatchState = computeDispatchState(taskTree);
          if (!dispatchState.valid) {
            console.log(
              JSON.stringify(
                {
                  status: "FAIL",
                  reason: "task tree is incomplete",
                  failed_checks: dispatchState.issues,
                  suggested_next_step: "fix_task_tree"
                },
                null,
                2
              )
            );
            process.exitCode = 1;
            return;
          }

          const root = findProjectRoot();
          const queuePath = await writeTaskTreeSnapshot(root, dispatchState.taskTree);
          const result = {
            task_id: dispatchState.taskTree.task_id,
            title: dispatchState.taskTree.title,
            status: "dispatched",
            queue_path: queuePath,
            ready_branches: dispatchState.ready_branches,
            waiting_branches: dispatchState.waiting_branches,
            branches: dispatchState.branches
          };
          console.log(JSON.stringify(result, null, 2));
        });

      internalDispatch
        .command("handoff")
        .action(async () => {
          const rawPayload = readJsonFromStdin();
          const taskTree =
            rawPayload?.task_tree && typeof rawPayload.task_tree === "object"
              ? rawPayload.task_tree
              : rawPayload?.queue_path
                ? JSON.parse(fs.readFileSync(rawPayload.queue_path, "utf8"))
                : rawPayload;
          const root = findProjectRoot();
          const result = await handoffReadyBranches(root, taskTree, {
            queuePath: rawPayload?.queue_path ?? undefined
          });
          if (!result.valid) {
            console.log(
              JSON.stringify(
                {
                  status: "FAIL",
                  reason: "task tree is incomplete",
                  failed_checks: result.issues,
                  suggested_next_step: "fix_task_tree"
                },
                null,
                2
              )
            );
            process.exitCode = 1;
            return;
          }

          console.log(JSON.stringify(result, null, 2));
        });

      internalDispatch
        .command("execute-ready")
        .action(async () => {
          const payload = readJsonFromStdin();
          const root = findProjectRoot();
          const result = await executeReadyBranches(root, payload);
          console.log(JSON.stringify(result, null, 2));
        });

      program
        .command("approval")
        .description("Emit a lightweight approval envelope for review gates.")
        .command("request")
        .option("--kind <kind>", "Approval kind", "review")
        .action((opts) => {
          const payload = readJsonFromStdin();
          console.log(
            JSON.stringify(
              {
                status: "approval_required",
                kind: opts.kind,
                approved: false,
                task_id: payload.task_id ?? null,
                summary: payload.title ?? payload.reason ?? "approval requested"
              },
              null,
              2
            )
          );
        });
    },
    { commands: ["validator-run", "internal-dispatch", "approval", "task-tree-normalize"] }
  );
}
