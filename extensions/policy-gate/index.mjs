import { Type } from "@sinclair/typebox";

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

function missingTaskTreeFields(taskTree) {
  if (!taskTree || typeof taskTree !== "object") {
    return ["taskTree is missing or invalid"];
  }

  const missing = [];
  if (!taskTree.task_id) missing.push("task_id");
  if (!taskTree.title) missing.push("title");
  if (!taskTree.mode) missing.push("mode");
  if (!Array.isArray(taskTree.branches) || taskTree.branches.length === 0) {
    missing.push("branches");
    return missing;
  }

  taskTree.branches.forEach((b, idx) => {
    if (!b.branch_id) missing.push(`branches[${idx}].branch_id`);
    if (!b.owner) missing.push(`branches[${idx}].owner`);
    if (!b.goal) missing.push(`branches[${idx}].goal`);
  });

  return missing;
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

      const result = {
        allowed: true,
        decision: "allow",
        nextAction: "continue",
        reasons: []
      };

      // 1. 复杂任务必须有 Task Tree
      if (params.isComplex && params.phase !== "pre-dispatch") {
        const missing = missingTaskTreeFields(taskTree);
        if (missing.length > 0) {
          result.allowed = false;
          result.decision = "deny";
          result.nextAction = "fix_task_tree";
          result.reasons.push(
            `complex task missing required task tree fields: ${missing.join(", ")}`
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
}