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

function getPaths(api) {
  const root = findProjectRoot();
  const cfg = api.runtime.config.loadConfig();
  const pluginCfg = cfg?.plugins?.entries?.["memory-bridge"]?.config ?? {};
  const markdownFiles =
    pluginCfg.markdownFiles?.map((item) => path.resolve(root, item)) ?? [
      path.join(root, "workspace-main", "MEMORY.md")
    ];

  return {
    root,
    markdownFiles,
    stagedDir: path.resolve(
      root,
      pluginCfg.stagedDir ?? path.join("shared", "runtime", "memory", "staged")
    ),
    conflictsDir: path.resolve(
      root,
      pluginCfg.conflictsDir ?? path.join("shared", "runtime", "memory", "conflicts")
    ),
    commitsDir: path.resolve(
      root,
      pluginCfg.commitsDir ?? path.join("shared", "runtime", "memory", "commits")
    )
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function listDailyMemoryFiles(root) {
  const dir = path.join(root, "workspace-main", "memory");
  try {
    const entries = await fsp.readdir(dir);
    return entries
      .filter((entry) => entry.endsWith(".md"))
      .sort()
      .map((entry) => path.join(dir, entry));
  } catch {
    return [];
  }
}

async function collectMarkdownFiles(pathsConfig) {
  const dailyFiles = await listDailyMemoryFiles(pathsConfig.root);
  const files = [...pathsConfig.markdownFiles, ...dailyFiles];
  return [...new Set(files)].filter((file) => fs.existsSync(file));
}

function buildToolText(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

async function searchMarkdown(pathsConfig, query, maxResults) {
  const files = await collectMarkdownFiles(pathsConfig);
  const lower = query.trim().toLowerCase();
  const results = [];

  for (const file of files) {
    const text = await fsp.readFile(file, "utf8");
    const haystack = text.toLowerCase();
    const firstIndex = haystack.indexOf(lower);
    if (firstIndex === -1) continue;
    const score = haystack.split(lower).length - 1;
    const preview = text.slice(Math.max(0, firstIndex - 80), firstIndex + query.length + 160).trim();
    results.push({
      scope: "markdown",
      source: file,
      score,
      preview
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

async function writeJsonRecord(dir, id, payload) {
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

async function appendToMarkdown(targetPath, textBlock) {
  let content = "";
  try {
    content = await fsp.readFile(targetPath, "utf8");
  } catch {
    content = "";
  }

  const section = "## Imported Facts";
  if (!content.includes(section)) {
    content = `${content.trim()}\n\n${section}\n`;
  }
  content = `${content.trimEnd()}\n- ${textBlock}\n`;
  await fsp.writeFile(targetPath, `${content.trimEnd()}\n`, "utf8");
}

async function readRecordById(pathsConfig, id) {
  for (const dir of [pathsConfig.stagedDir, pathsConfig.conflictsDir, pathsConfig.commitsDir]) {
    const candidate = path.join(dir, `${id}.json`);
    if (fs.existsSync(candidate)) {
      const raw = await fsp.readFile(candidate, "utf8");
      return { filePath: candidate, payload: JSON.parse(raw) };
    }
  }
  return null;
}

export default function register(api) {
  api.registerTool(
    {
      name: "memory_bridge_health",
      description: "Report local memory-bridge readiness and current storage paths.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute() {
        const pathsConfig = getPaths(api);
        const markdownFiles = await collectMarkdownFiles(pathsConfig);
        return buildToolText({
          root: pathsConfig.root,
          markdown_files: markdownFiles,
          staged_dir: pathsConfig.stagedDir,
          conflicts_dir: pathsConfig.conflictsDir,
          commits_dir: pathsConfig.commitsDir,
          staged_count: fs.existsSync(pathsConfig.stagedDir)
            ? (await fsp.readdir(pathsConfig.stagedDir)).length
            : 0,
          conflicts_count: fs.existsSync(pathsConfig.conflictsDir)
            ? (await fsp.readdir(pathsConfig.conflictsDir)).length
            : 0
        });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "memory_bridge_retrieve",
      description: "Search Markdown truth memory and staged records through the local bridge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "integer", minimum: 1, default: 5 }
        },
        required: ["query"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const pathsConfig = getPaths(api);
        const results = await searchMarkdown(pathsConfig, params.query, params.max_results ?? 5);
        return buildToolText({ query: params.query, results });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "memory_bridge_stage_fact",
      description: "Stage a candidate fact for later review and commit.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          source: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["text", "source", "confidence"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const pathsConfig = getPaths(api);
        const id = `${Date.now()}-${slugify(params.text) || "fact"}`;
        const payload = {
          id,
          text: params.text,
          source: params.source,
          confidence: params.confidence,
          tags: params.tags ?? [],
          staged_at: new Date().toISOString()
        };
        const filePath = await writeJsonRecord(pathsConfig.stagedDir, id, payload);
        return buildToolText({ status: "staged", id, file_path: filePath });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "memory_bridge_commit_fact",
      description: "Commit a staged fact into Markdown truth memory after explicit approval.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          approved_by: { type: "string" },
          target_path: { type: "string" }
        },
        required: ["id", "approved_by"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const pathsConfig = getPaths(api);
        const record = await readRecordById(pathsConfig, params.id);
        if (!record) {
          return buildToolText({ status: "missing", id: params.id });
        }

        const targetPath =
          params.target_path != null
            ? path.resolve(pathsConfig.root, params.target_path)
            : path.join(pathsConfig.root, "workspace-main", "MEMORY.md");

        const textBlock =
          `${record.payload.text}\n` +
          `  - source: ${record.payload.source}\n` +
          `  - confidence: ${record.payload.confidence}\n` +
          `  - approved_by: ${params.approved_by}\n` +
          `  - committed_at: ${new Date().toISOString()}`;

        await appendToMarkdown(targetPath, textBlock);
        const commitPath = await writeJsonRecord(pathsConfig.commitsDir, params.id, {
          ...record.payload,
          approved_by: params.approved_by,
          committed_at: new Date().toISOString(),
          target_path: targetPath
        });
        if (record.filePath !== commitPath) {
          await fsp.rm(record.filePath, { force: true });
        }
        return buildToolText({ status: "committed", id: params.id, target_path: targetPath, commit_path: commitPath });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "memory_bridge_resolve_conflict",
      description: "Archive a conflict-resolution decision for a staged or conflicted memory record.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          action: { type: "string", enum: ["keep", "replace", "merge", "defer"] },
          notes: { type: "string" }
        },
        required: ["id", "action"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const pathsConfig = getPaths(api);
        const record = await readRecordById(pathsConfig, params.id);
        if (!record) {
          return buildToolText({ status: "missing", id: params.id });
        }

        const destinationDir =
          params.action === "defer" ? pathsConfig.conflictsDir : pathsConfig.commitsDir;
        const filePath = await writeJsonRecord(destinationDir, params.id, {
          ...record.payload,
          resolution_action: params.action,
          resolution_notes: params.notes ?? "",
          resolved_at: new Date().toISOString()
        });
        if (record.filePath !== filePath) {
          await fsp.rm(record.filePath, { force: true });
        }
        return buildToolText({ status: "resolved", id: params.id, action: params.action, file_path: filePath });
      }
    },
    { optional: true }
  );

  api.registerCli(
    ({ program }) => {
      program
        .command("memory-bridge")
        .description("Inspect local memory-bridge status.")
        .command("status")
        .action(async () => {
          const pathsConfig = getPaths(api);
          const markdownFiles = await collectMarkdownFiles(pathsConfig);
          console.log(
            JSON.stringify(
              {
                root: pathsConfig.root,
                markdown_files: markdownFiles,
                staged_dir: pathsConfig.stagedDir,
                conflicts_dir: pathsConfig.conflictsDir,
                commits_dir: pathsConfig.commitsDir
              },
              null,
              2
            )
          );
        });
    },
    { commands: ["memory-bridge"] }
  );
}
