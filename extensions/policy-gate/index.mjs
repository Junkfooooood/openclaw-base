import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

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
  if (!taskTree.approval_mode) missing.push("approval_mode");
  if (!taskTree.retry_policy) missing.push("retry_policy");
  if (!Array.isArray(taskTree.branches) || taskTree.branches.length === 0) {
    missing.push("branches");
    return missing;
  }

  taskTree.branches.forEach((b, idx) => {
    if (!b.branch_id) missing.push(`branches[${idx}].branch_id`);
    if (!b.owner) missing.push(`branches[${idx}].owner`);
    if (!b.goal) missing.push(`branches[${idx}].goal`);
    if (!Array.isArray(b.expected_output) || b.expected_output.length === 0) {
      missing.push(`branches[${idx}].expected_output`);
    }
    if (!Array.isArray(b.acceptance) || b.acceptance.length === 0) {
      missing.push(`branches[${idx}].acceptance`);
    }
  });

  return missing;
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

function findProjectRoot(startDir = process.cwd()) {
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

function readJsonFromStdin() {
  const raw = fs.readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function writeTaskTreeSnapshot(root, taskTree) {
  const queueDir = path.join(root, "shared", "runtime", "queue");
  await fsp.mkdir(queueDir, { recursive: true });
  const queuePath = path.join(queueDir, `${taskTree.task_id}.json`);
  await fsp.writeFile(queuePath, `${JSON.stringify(taskTree, null, 2)}\n`, "utf8");
  return queuePath;
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

  api.registerCli(
    ({ program }) => {
      program
        .command("validator-run")
        .description("Run lightweight structural validation for workflow outputs.")
        .action(() => {
          const payload = readJsonFromStdin();
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
          }

          const result = blocked
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

          console.log(JSON.stringify(result, null, 2));
        });

      program
        .command("internal-dispatch")
        .description("Persist a task tree and emit a minimal dispatch summary.")
        .command("run")
        .action(async () => {
          const taskTree = readJsonFromStdin();
          const missing = missingTaskTreeFields(taskTree);
          if (missing.length > 0) {
            console.log(
              JSON.stringify(
                {
                  status: "FAIL",
                  reason: "task tree is incomplete",
                  failed_checks: missing,
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
          const queuePath = await writeTaskTreeSnapshot(root, taskTree);
          const result = {
            task_id: taskTree.task_id,
            title: taskTree.title,
            status: "dispatched",
            queue_path: queuePath,
            branches: taskTree.branches.map((branch) => ({
              branch_id: branch.branch_id,
              owner: branch.owner,
              status: "queued",
              depends_on: branch.depends_on ?? []
            }))
          };
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
    { commands: ["validator-run", "internal-dispatch", "approval"] }
  );
}
