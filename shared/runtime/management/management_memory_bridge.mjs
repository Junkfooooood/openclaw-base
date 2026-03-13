import { spawn } from "node:child_process";
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

function slugify(value, fallback = "item") {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || fallback;
}

function resolveConfiguredPath(root, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function resolveCommandPath(root, value, fallback) {
  const raw = value ?? fallback;
  if (path.isAbsolute(raw)) return raw;
  if (raw.includes("/") || raw.startsWith(".")) {
    return path.resolve(root, raw);
  }
  return raw;
}

function readOpenClawConfig(root) {
  const runtimeConfigPath = path.join(root, "openclaw.json");
  const templateConfigPath = path.join(root, "openclaw.template.json");
  const preferred = fs.existsSync(runtimeConfigPath) ? runtimeConfigPath : templateConfigPath;
  if (!fs.existsSync(preferred)) return {};
  return JSON.parse(fs.readFileSync(preferred, "utf8"));
}

export function managementWorkingSessionId(taskId, branchId = null) {
  const parts = ["mgmt", slugify(taskId, "task")];
  if (branchId) parts.push(slugify(branchId, "branch"));
  return parts.join("-");
}

function getMemoryBridgeConfig(root) {
  const cfg = readOpenClawConfig(root);
  const pluginCfg = cfg?.plugins?.entries?.["memory-bridge"]?.config ?? {};
  const mem0Cfg = pluginCfg.mem0 ?? {};
  const managementCfg = pluginCfg.management ?? {};

  return {
    root,
    amsBaseUrl: pluginCfg.amsBaseUrl ?? null,
    amsAuthToken: pluginCfg.amsAuthToken ?? null,
    pythonBin: resolveCommandPath(root, pluginCfg.pythonBin, "python3"),
    pythonScript: resolveConfiguredPath(
      root,
      pluginCfg.pythonScript ?? path.join("shared", "bridge", "memory_bridge.py")
    ),
    envFile: resolveConfiguredPath(root, pluginCfg.envFile ?? null),
    defaultUserId: pluginCfg.defaultUserId ?? "lin-main",
    defaultNamespace: managementCfg.namespace ?? "openclaw-management",
    retentionDays: Number(managementCfg.retentionDays ?? 7),
    mirrorDir: path.resolve(
      root,
      managementCfg.mirrorDir ?? path.join("shared", "runtime", "memory", "management")
    ),
    syncTaskTreeToWorking: managementCfg.syncTaskTreeToWorking ?? true,
    syncBranchPacketToWorking: managementCfg.syncBranchPacketToWorking ?? true,
    syncActivityToWorking: managementCfg.syncActivityToWorking ?? true,
    syncSearchTraceToWorking: managementCfg.syncSearchTraceToWorking ?? true,
    syncStrategyReviewToSemanticGraph: managementCfg.syncStrategyReviewToSemanticGraph ?? true,
    syncSearchTraceToSemanticGraph: managementCfg.syncSearchTraceToSemanticGraph ?? false,
    mem0: {
      qdrantUrl: mem0Cfg.qdrantUrl ?? "http://127.0.0.1:6333",
      collectionName: mem0Cfg.collectionName ?? "openclaw_memory",
      embeddingModelDims: mem0Cfg.embeddingModelDims ?? 1536,
      llmModel: mem0Cfg.llmModel ?? "gpt-4.1-mini",
      embedderModel: mem0Cfg.embedderModel ?? "text-embedding-3-small",
      historyDbPath: resolveConfiguredPath(
        root,
        mem0Cfg.historyDbPath ?? path.join("shared", "runtime", "memory", "mem0_history.db")
      ),
      neo4jUrl: mem0Cfg.neo4jUrl ?? null,
      neo4jUsername: mem0Cfg.neo4jUsername ?? null,
      neo4jDatabase: mem0Cfg.neo4jDatabase ?? "neo4j",
      enableGraph: mem0Cfg.enableGraph ?? true
    }
  };
}

function buildRecordId(record) {
  return [
    Date.now(),
    slugify(record.task_id, "task"),
    slugify(record.kind, "record"),
    slugify(record.branch_id ?? "task", "branch")
  ].join("-");
}

function buildWorkingText(record) {
  const lines = [
    `[management:${record.kind}] ${record.summary}`,
    `task_id=${record.task_id}`
  ];
  if (record.branch_id) lines.push(`branch_id=${record.branch_id}`);
  if (record.owner) lines.push(`owner=${record.owner}`);
  if (record.route) lines.push(`route=${record.route}`);
  if (record.tool_mode) lines.push(`tool_mode=${record.tool_mode}`);
  if (record.model_hint) lines.push(`model_hint=${record.model_hint}`);
  if (record.detail) {
    lines.push("");
    lines.push(record.detail);
  }
  return lines.join("\n");
}

function amsHeaders(config) {
  const headers = { "content-type": "application/json" };
  if (config.amsAuthToken) {
    headers.authorization = `Bearer ${config.amsAuthToken}`;
  }
  return headers;
}

async function fetchJson(config, endpoint, options = {}) {
  if (!config.amsBaseUrl) {
    throw new Error("AMS is not configured: missing amsBaseUrl");
  }

  const response = await fetch(`${config.amsBaseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...amsHeaders(config),
      ...(options.headers ?? {})
    },
    signal: AbortSignal.timeout(15000)
  });

  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    const error = new Error(`AMS request failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function runPythonBridge(config, command, payload = {}) {
  if (!config.pythonScript || !fs.existsSync(config.pythonScript)) {
    throw new Error(`python bridge script not found: ${config.pythonScript}`);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, [config.pythonScript, command], {
      cwd: config.root,
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
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : {};
        if (code !== 0 || parsed.status === "error") {
          const error = new Error(parsed.error ?? stderr.trim() ?? `python bridge exited with ${code}`);
          error.stderr = stderr.trim();
          error.stdout = stdout.trim();
          reject(error);
          return;
        }
        resolve(parsed);
      } catch (error) {
        error.stderr = stderr.trim();
        error.stdout = stdout.trim();
        reject(error);
      }
    });

    child.stdin.write(
      JSON.stringify({
        ...payload,
        env_file: config.envFile,
        bridge_config: {
          qdrantUrl: config.mem0.qdrantUrl,
          collectionName: config.mem0.collectionName,
          embeddingModelDims: config.mem0.embeddingModelDims,
          llmModel: config.mem0.llmModel,
          embedderModel: config.mem0.embedderModel,
          historyDbPath: config.mem0.historyDbPath,
          neo4jUrl: config.mem0.neo4jUrl,
          neo4jUsername: config.mem0.neo4jUsername,
          neo4jDatabase: config.mem0.neo4jDatabase,
          enableGraph: config.mem0.enableGraph
        }
      })
    );
    child.stdin.end();
  });
}

async function ensureMirrorDir(config) {
  await fsp.mkdir(config.mirrorDir, { recursive: true });
}

async function loadMirrorRecords(config, sessionId) {
  await ensureMirrorDir(config);
  const entries = await fsp.readdir(config.mirrorDir);
  const records = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const candidate = path.join(config.mirrorDir, entry);
    const raw = await fsp.readFile(candidate, "utf8");
    const record = JSON.parse(raw);
    if (record.session_id === sessionId) {
      records.push({ filePath: candidate, ...record });
    }
  }
  return records.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

async function pruneExpiredMirrorRecords(config, sessionId = null) {
  await ensureMirrorDir(config);
  const now = Date.now();
  const entries = await fsp.readdir(config.mirrorDir);
  const removed = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const candidate = path.join(config.mirrorDir, entry);
    const raw = await fsp.readFile(candidate, "utf8");
    const record = JSON.parse(raw);
    if (sessionId && record.session_id !== sessionId) continue;
    if (record.expires_at && new Date(record.expires_at).getTime() <= now) {
      await fsp.rm(candidate, { force: true });
      removed.push(candidate);
    }
  }
  return removed;
}

async function writeMirrorRecord(config, record) {
  await ensureMirrorDir(config);
  const filePath = path.join(config.mirrorDir, `${record.id}.json`);
  await fsp.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return filePath;
}

async function syncWorkingSessionFromMirror(config, sessionId, userId, namespace) {
  if (!config.amsBaseUrl) {
    return { status: "skipped", reason: "amsBaseUrl not configured" };
  }

  await pruneExpiredMirrorRecords(config, sessionId);
  const records = await loadMirrorRecords(config, sessionId);
  const now = new Date().toISOString();
  const payload = {
    messages: records.map((record) => ({
      id: `${record.id}-message`,
      role: "system",
      content: record.working_text,
      created_at: record.created_at
    })),
    memories: records.map((record) => ({
      id: record.id,
      text: record.working_text,
      memory_type: "semantic",
      topics: record.tags ?? [],
      user_id: userId,
      namespace
    })),
    data: {
      kind: "management",
      record_count: records.length,
      retention_days: config.retentionDays
    },
    context: null,
    user_id: userId,
    namespace,
    created_at: records[0]?.created_at ?? now,
    updated_at: now
  };

  const response = await fetchJson(config, `/v1/working-memory/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  return {
    status: "ok",
    session_id: sessionId,
    mirror_record_count: records.length,
    message_count: response.messages?.length ?? 0,
    memory_count: response.memories?.length ?? 0
  };
}

export async function syncManagementRecord(rootOrRecord, maybeRecord = null) {
  const root = maybeRecord ? rootOrRecord : findProjectRoot();
  const input = maybeRecord ?? rootOrRecord;
  const config = getMemoryBridgeConfig(root);
  const userId = input.user_id ?? config.defaultUserId;
  const namespace = input.namespace ?? config.defaultNamespace;
  const sessionId = input.session_id ?? managementWorkingSessionId(input.task_id, input.branch_id);
  const retentionDays = Number(input.retention_days ?? config.retentionDays);
  const createdAt = input.created_at ?? new Date().toISOString();
  const expiresAt = input.expires_at ?? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const workingText = input.working_text ?? buildWorkingText(input);

  const record = {
    id: input.id ?? buildRecordId({ ...input, session_id: sessionId }),
    kind: input.kind,
    task_id: input.task_id,
    branch_id: input.branch_id ?? null,
    owner: input.owner ?? null,
    route: input.route ?? null,
    tool_mode: input.tool_mode ?? null,
    model_hint: input.model_hint ?? null,
    title: input.title ?? null,
    summary: input.summary ?? "",
    detail: input.detail ?? "",
    working_text: workingText,
    semantic_text: input.semantic_text ?? input.summary ?? workingText,
    user_id: userId,
    namespace,
    session_id: sessionId,
    tags: Array.isArray(input.tags) ? input.tags : [],
    metadata: input.metadata ?? {},
    created_at: createdAt,
    expires_at: expiresAt
  };

  const mirrorPath = await writeMirrorRecord(config, record);
  const working = await syncWorkingSessionFromMirror(config, sessionId, userId, namespace).catch((error) => ({
    status: "error",
    error: error.message
  }));

  let semanticGraph = { status: "skipped" };
  if (input.sync_semantic_graph) {
    try {
      semanticGraph = await runPythonBridge(config, "add", {
        text: record.semantic_text,
        user_id: userId,
        metadata: {
          source: "management-memory-bridge",
          tags: record.tags,
          namespace,
          task_id: record.task_id,
          branch_id: record.branch_id,
          kind: record.kind,
          expires_at: record.expires_at
        }
      });
    } catch (error) {
      semanticGraph = { status: "error", error: error.message };
    }
  }

  return {
    status: "ok",
    id: record.id,
    session_id: sessionId,
    mirror_path: mirrorPath,
    working,
    semantic_graph: semanticGraph
  };
}

export function managementMemoryDefaults(root = findProjectRoot()) {
  return getMemoryBridgeConfig(root);
}
