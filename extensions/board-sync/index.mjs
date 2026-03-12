import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

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

function resolveDirs(api, root) {
  const cfg = api.runtime.config.loadConfig();
  const pluginCfg = cfg?.plugins?.entries?.["board-sync"]?.config ?? {};
  return {
    hotDir: path.resolve(root, pluginCfg.hotDir ?? path.join("shared", "blackboard", "hot")),
    archiveDir: path.resolve(
      root,
      pluginCfg.archiveDir ?? path.join("shared", "blackboard", "archive")
    )
  };
}

function cardPath(dir, taskId) {
  return path.join(dir, `${taskId}.md`);
}

function buildCard(taskTree) {
  const now = new Date().toISOString();
  const branchLines = (taskTree.branches ?? []).map(
    (branch) => `- [pending] ${branch.branch_id} | owner=${branch.owner} | goal=${branch.goal}`
  );
  return [
    "---",
    `task_id: ${taskTree.task_id}`,
    `title: ${taskTree.title}`,
    "owner: main",
    "status: pending",
    "priority: normal",
    `created_at: ${now}`,
    `updated_at: ${now}`,
    `current_branch: ${(taskTree.branches?.[0]?.branch_id ?? "main")}`,
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
    "- dispatch branches",
    "",
    "# Risk / Blocker",
    "- none"
  ].join("\n");
}

function replaceSection(markdown, title, content) {
  const pattern = new RegExp(`(^# ${title}\\n)([\\s\\S]*?)(?=\\n# |$)`, "m");
  if (pattern.test(markdown)) {
    return markdown.replace(pattern, `$1${content}\n`);
  }
  return `${markdown.trim()}\n\n# ${title}\n${content}\n`;
}

function replaceFrontmatterValue(markdown, key, value) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value);
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(markdown)) {
    return markdown.replace(pattern, `${key}: ${serialized}`);
  }
  return markdown;
}

export default function register(api) {
  api.registerCli(
    ({ program }) => {
      const board = program.command("board-sync").description("Manage shared blackboard cards.");

      board.command("init").action(async () => {
        const taskTree = readJsonFromStdin();
        const root = findProjectRoot();
        const { hotDir } = resolveDirs(api, root);
        await fsp.mkdir(hotDir, { recursive: true });
        const target = cardPath(hotDir, taskTree.task_id);
        await fsp.writeFile(target, `${buildCard(taskTree)}\n`, "utf8");
        console.log(
          JSON.stringify(
            {
              status: "initialized",
              task_id: taskTree.task_id,
              card_path: target
            },
            null,
            2
          )
        );
      });

      board.command("update").action(async () => {
        const payload = readJsonFromStdin();
        const root = findProjectRoot();
        const { hotDir } = resolveDirs(api, root);
        const target = cardPath(hotDir, payload.task_id);
        let markdown = await fsp.readFile(target, "utf8");

        markdown = replaceFrontmatterValue(markdown, "status", payload.status ?? "pending");
        markdown = replaceFrontmatterValue(markdown, "updated_at", new Date().toISOString());
        markdown = replaceFrontmatterValue(
          markdown,
          "current_branch",
          payload.current_branch ?? "main"
        );
        markdown = replaceFrontmatterValue(markdown, "blocker", payload.blocker ?? "null");
        markdown = replaceFrontmatterValue(
          markdown,
          "retry_count",
          payload.retry_count ?? {}
        );

        markdown = replaceSection(markdown, "Last Action", payload.last_action ?? "- updated");
        markdown = replaceSection(
          markdown,
          "Current Outputs",
          Array.isArray(payload.current_outputs)
            ? payload.current_outputs.map((item) => `- ${item}`).join("\n")
            : payload.current_outputs ?? "- none"
        );
        markdown = replaceSection(markdown, "Next Step", payload.next_step ?? "- continue");
        markdown = replaceSection(
          markdown,
          "Risk / Blocker",
          payload.blocker ? `- ${payload.blocker}` : "- none"
        );
        if (Array.isArray(payload.branch_status) && payload.branch_status.length > 0) {
          markdown = replaceSection(
            markdown,
            "Branch Status",
            payload.branch_status.map((item) => `- ${item}`).join("\n")
          );
        }

        await fsp.writeFile(target, markdown, "utf8");
        console.log(JSON.stringify({ status: "updated", task_id: payload.task_id, card_path: target }, null, 2));
      });

      board.command("finalize").action(async () => {
        const payload = readJsonFromStdin();
        const root = findProjectRoot();
        const { hotDir, archiveDir } = resolveDirs(api, root);
        await fsp.mkdir(archiveDir, { recursive: true });
        const source = cardPath(hotDir, payload.task_id);
        const destination = cardPath(archiveDir, payload.task_id);
        await fsp.rename(source, destination);
        console.log(
          JSON.stringify(
            {
              status: "archived",
              task_id: payload.task_id,
              card_path: destination
            },
            null,
            2
          )
        );
      });
    },
    { commands: ["board-sync"] }
  );
}
