import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const HYBRID_SCOPE_WEIGHTS = {
  markdown: 1,
  commit: 0.97,
  conflict: 0.72,
  staged: 0.76,
  "working-memory": 0.79,
  "working-message": 0.7,
  semantic: 0.83,
  graph: 0.67
};

const NEGATION_TOKENS = [
  "not",
  "no",
  "never",
  "without",
  "cannot",
  "can't",
  "禁止",
  "不得",
  "不是",
  "不",
  "未",
  "无",
  "没有"
];

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

function getPaths(api) {
  const root = findProjectRoot();
  const cfg = api.runtime.config.loadConfig();
  const pluginCfg = cfg?.plugins?.entries?.["memory-bridge"]?.config ?? {};
  const mem0Cfg = pluginCfg.mem0 ?? {};
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
    ),
    pythonBin: resolveCommandPath(root, pluginCfg.pythonBin, "python3"),
    pythonScript: resolveConfiguredPath(
      root,
      pluginCfg.pythonScript ?? path.join("shared", "bridge", "memory_bridge.py")
    ),
    envFile: resolveConfiguredPath(root, pluginCfg.envFile ?? null),
    amsBaseUrl: pluginCfg.amsBaseUrl ?? null,
    amsAuthToken: pluginCfg.amsAuthToken ?? null,
    defaultUserId: pluginCfg.defaultUserId ?? null,
    defaultSessionId: pluginCfg.defaultSessionId ?? null,
    defaultNamespace: pluginCfg.defaultNamespace ?? null,
    autoSyncConfidence: pluginCfg.autoSyncConfidence ?? 0.92,
    autoSyncToSemanticGraph: pluginCfg.autoSyncToSemanticGraph ?? false,
    mem0: {
      qdrantUrl: mem0Cfg.qdrantUrl ?? "http://127.0.0.1:6333",
      collectionName: mem0Cfg.collectionName ?? "openclaw_memory",
      embeddingModelDims: mem0Cfg.embeddingModelDims ?? 1536,
      llmModel: mem0Cfg.llmModel ?? "gpt-4.1-mini",
      embedderModel: mem0Cfg.embedderModel ?? "text-embedding-3-small",
      neo4jUrl: mem0Cfg.neo4jUrl ?? null,
      neo4jUsername: mem0Cfg.neo4jUsername ?? null,
      neo4jDatabase: mem0Cfg.neo4jDatabase ?? "neo4j",
      enableGraph: mem0Cfg.enableGraph ?? true
    }
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

function pickBestSnippet(text, query, maxChars = 240) {
  const candidates = text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  let bestSnippet = text.slice(0, maxChars).trim();
  let bestScore = 0;

  for (const candidate of candidates) {
    const exact = normalizeText(candidate).includes(normalizeText(query)) ? 1 : 0;
    const overlap = countTokenOverlap(query, candidate);
    const similarity = jaccard(query, candidate);
    const score = exact * 2 + overlap + similarity;
    if (score <= bestScore) continue;
    bestScore = score;
    bestSnippet = candidate.slice(0, maxChars).trim();
  }

  return bestSnippet;
}

async function searchMarkdown(pathsConfig, query, maxResults) {
  const files = await collectMarkdownFiles(pathsConfig);
  const lower = query.trim().toLowerCase();
  const results = [];

  for (const file of files) {
    const text = await fsp.readFile(file, "utf8");
    const haystack = text.toLowerCase();
    const firstIndex = haystack.indexOf(lower);
    const exact = firstIndex === -1 ? 0 : 1;
    const overlap = countTokenOverlap(query, text);
    const similarity = jaccard(query, text);
    if (Math.max(exact, overlap, similarity) < 0.25) continue;
    const score = Number((exact * 2 + overlap + similarity).toFixed(3));
    const preview =
      firstIndex >= 0
        ? text.slice(Math.max(0, firstIndex - 80), firstIndex + query.length + 160).trim()
        : pickBestSnippet(text, query);
    results.push({
      scope: "markdown",
      source: file,
      score,
      preview
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function readJsonFile(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function readLocalRecordDir(dir, scope) {
  try {
    const entries = (await fsp.readdir(dir)).filter((entry) => entry.endsWith(".json")).sort();
    const records = [];
    for (const entry of entries) {
      const filePath = path.join(dir, entry);
      try {
        const payload = await readJsonFile(filePath);
        records.push({
          scope,
          source: filePath,
          preview: getComparableText(payload).slice(0, 240),
          ...payload
        });
      } catch {
        // Ignore malformed local records so retrieval remains resilient.
      }
    }
    return records;
  } catch {
    return [];
  }
}

async function searchLocalRecordDir(dir, scope, query, maxResults) {
  const records = await readLocalRecordDir(dir, scope);
  const matches = [];

  for (const record of records) {
    const preview = getComparableText(record);
    const exact = normalizeText(preview).includes(normalizeText(query)) ? 1 : 0;
    const overlap = countTokenOverlap(query, preview);
    const similarity = jaccard(query, preview);
    if (Math.max(exact, overlap, similarity) < 0.3) continue;
    matches.push({
      scope,
      source: record.source,
      preview: preview.slice(0, 240),
      score: Number((exact * 2 + overlap + similarity).toFixed(3)),
      record_id: record.id ?? path.basename(record.source, ".json"),
      confidence: record.confidence ?? null,
      resolution_action: record.resolution_action ?? null
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

async function collectLocalSnapshot(pathsConfig, query, maxResults) {
  return {
    staged: await searchLocalRecordDir(pathsConfig.stagedDir, "staged", query, maxResults),
    conflicts: await searchLocalRecordDir(pathsConfig.conflictsDir, "conflict", query, maxResults),
    commits: await searchLocalRecordDir(pathsConfig.commitsDir, "commit", query, maxResults)
  };
}

function normalizeRawScore(scope, value) {
  if (!Number.isFinite(value)) return 0;
  if (scope === "semantic" || scope === "graph") {
    return clamp(Number(value), 0, 1);
  }
  return clamp(Number(value) / 3, 0, 1);
}

function countTokenOverlap(query, text) {
  const queryTokens = tokenize(query);
  const textTokens = tokenize(text);
  if (queryTokens.size === 0 || textTokens.size === 0) return 0;

  let hits = 0;
  for (const item of queryTokens) {
    if (textTokens.has(item)) hits += 1;
  }
  return hits / queryTokens.size;
}

function trustTierForScope(scope) {
  if (scope === "markdown" || scope === "commit") return "truth";
  if (scope === "semantic" || scope === "graph") return "enhanced";
  if (scope === "working-memory" || scope === "working-message") return "runtime";
  return "pending";
}

function getPreviewText(item) {
  return String(item.preview ?? item.memory ?? getComparableText(item) ?? "").trim();
}

function buildHybridResult(query, item) {
  const preview = getPreviewText(item);
  const exact = normalizeText(preview).includes(normalizeText(query)) ? 1 : 0;
  const overlap = countTokenOverlap(query, preview);
  const semanticSimilarity = jaccard(query, preview);
  const rawScore = normalizeRawScore(item.scope, Number(item.score));
  const scopeWeight = HYBRID_SCOPE_WEIGHTS[item.scope] ?? 0.6;
  const hybridScore = Number(
    (
      scopeWeight * 0.35 +
      rawScore * 0.15 +
      overlap * 0.25 +
      semanticSimilarity * 0.15 +
      exact * 0.1
    ).toFixed(3)
  );

  return {
    scope: item.scope,
    source: item.source ?? null,
    preview: preview.slice(0, 240),
    raw_score: Number(rawScore.toFixed(3)),
    hybrid_score: hybridScore,
    trust_tier: trustTierForScope(item.scope)
  };
}

function buildFusedResults(query, snapshot, maxResults) {
  const seen = new Set();
  return flattenSnapshot(snapshot)
    .map((item) => buildHybridResult(query, item))
    .filter((item) => {
      const key = `${item.scope}:${item.source}:${item.preview}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return item.hybrid_score > 0.3;
    })
    .sort((a, b) => b.hybrid_score - a.hybrid_score || a.scope.localeCompare(b.scope))
    .slice(0, maxResults);
}

function buildRetrievalAdvisories(snapshot, fusedResults) {
  const advisories = [];

  if ((snapshot.conflicts ?? []).length > 0) {
    advisories.push("retrieval matched unresolved conflict records; prefer Markdown truth before pending memory candidates");
  }

  const hasTruthHit = fusedResults.some((item) => item.scope === "markdown" || item.scope === "commit");
  const hasEnhancedHit = fusedResults.some((item) => item.scope === "semantic" || item.scope === "graph");
  if (!hasTruthHit && hasEnhancedHit) {
    advisories.push("top matches come from enhanced memory, but no Markdown truth hit was found");
  }

  if ((snapshot.staged ?? []).length > 0) {
    advisories.push("some matches come from staged memory and are not yet approved truth");
  }

  if ((snapshot.errors ?? []).length > 0) {
    advisories.push("one or more memory layers returned errors; retrieval quality may be degraded");
  }

  return advisories;
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

function getComparableText(record) {
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (typeof record.preview === "string") return record.preview;
  if (typeof record.memory === "string") return record.memory;
  if (
    typeof record.source === "string" &&
    typeof record.relationship === "string" &&
    (typeof record.destination === "string" || typeof record.target === "string")
  ) {
    return `${record.source} ${record.relationship} ${record.destination ?? record.target}`;
  }
  return JSON.stringify(record);
}

function normalizeText(value) {
  return getComparableText({ text: value })
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  const tokens = new Set(
    normalized
      .split(" ")
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  );

  // Chinese-heavy text often has too few whitespace tokens; fall back to bigrams.
  if (tokens.size <= 1) {
    const compact = normalized.replace(/\s+/g, "");
    for (let index = 0; index < compact.length - 1; index += 1) {
      const gram = compact.slice(index, index + 2);
      if (gram.length >= 2) tokens.add(gram);
    }
  }

  return tokens;
}

function jaccard(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function hasNegationCue(value) {
  const raw = String(value ?? "").toLowerCase();
  const normalized = normalizeText(value);
  return NEGATION_TOKENS.some((token) => raw.includes(token) || normalized.includes(token));
}

function conflictSeverityRank(level) {
  return level === "high" ? 3 : level === "medium" ? 2 : 1;
}

function detectConflicts(candidateText, records) {
  const normalizedCandidate = normalizeText(candidateText);
  const conflicts = [];

  for (const record of records) {
    const comparisonText = getComparableText(record);
    const normalizedRecord = normalizeText(comparisonText);
    if (!normalizedRecord || normalizedRecord === normalizedCandidate) continue;
    const similarity = jaccard(candidateText, comparisonText);
    const overlap = countTokenOverlap(candidateText, comparisonText);
    if (Math.max(similarity, overlap) < 0.35) continue;

    const negationMismatch = hasNegationCue(candidateText) !== hasNegationCue(comparisonText);
    let relation = "overlap";
    if (similarity >= 0.82 && overlap >= 0.7 && !negationMismatch) {
      relation = "duplicate";
    } else if (negationMismatch && (similarity >= 0.45 || overlap >= 0.5)) {
      relation = "contradiction";
    }

    let severity = relation === "contradiction" ? "high" : relation === "duplicate" ? "low" : "medium";
    if ((record.scope === "markdown" || record.scope === "commit") && relation !== "duplicate") {
      severity = "high";
    }
    const reviewRequired =
      severity === "high" ||
      ((record.scope === "markdown" || record.scope === "commit" || record.scope === "conflict") &&
        severity === "medium");

    conflicts.push({
      scope: record.scope ?? "unknown",
      source: record.source ?? null,
      relation,
      severity,
      review_required: reviewRequired,
      similarity: Number(similarity.toFixed(3)),
      overlap: Number(overlap.toFixed(3)),
      preview: comparisonText.slice(0, 240)
    });
  }

  return conflicts.sort((a, b) => {
    const reviewDelta = Number(b.review_required) - Number(a.review_required);
    if (reviewDelta !== 0) return reviewDelta;
    const severityDelta = conflictSeverityRank(b.severity) - conflictSeverityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.similarity - a.similarity;
  });
}

function amsHeaders(pathsConfig) {
  const headers = { "content-type": "application/json" };
  if (pathsConfig.amsAuthToken) {
    headers.authorization = `Bearer ${pathsConfig.amsAuthToken}`;
  }
  return headers;
}

async function fetchJson(pathsConfig, endpoint, options = {}) {
  if (!pathsConfig.amsBaseUrl) {
    throw new Error("AMS is not configured: missing amsBaseUrl");
  }

  const response = await fetch(`${pathsConfig.amsBaseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...amsHeaders(pathsConfig),
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

function searchWorkingCollection(items, query, mapper) {
  const lower = query.trim().toLowerCase();
  return items
    .map(mapper)
    .filter((item) => item.preview.toLowerCase().includes(lower))
    .slice(0, 5);
}

async function searchWorkingMemory(pathsConfig, query, sessionId, userId, namespace) {
  if (!pathsConfig.amsBaseUrl || !sessionId) {
    return { status: "skipped", results: [] };
  }

  const params = new URLSearchParams();
  if (userId) params.set("user_id", userId);
  if (namespace) params.set("namespace", namespace);

  try {
    const payload = await fetchJson(
      pathsConfig,
      `/v1/working-memory/${encodeURIComponent(sessionId)}${params.toString() ? `?${params.toString()}` : ""}`
    );

    const messageResults = searchWorkingCollection(payload.messages ?? [], query, (item) => ({
      scope: "working-message",
      source: sessionId,
      score: 1,
      preview: `${item.role}: ${item.content}`
    }));
    const memoryResults = searchWorkingCollection(payload.memories ?? [], query, (item) => ({
      scope: "working-memory",
      source: sessionId,
      score: 1,
      preview: item.text
    }));

    return {
      status: "ok",
      session_id: sessionId,
      results: [...messageResults, ...memoryResults]
    };
  } catch (error) {
    if (error.status === 404) {
      return { status: "missing", session_id: sessionId, results: [] };
    }
    return {
      status: "error",
      session_id: sessionId,
      results: [],
      error: error.message
    };
  }
}

async function getExistingWorkingMemory(pathsConfig, sessionId, userId, namespace) {
  const params = new URLSearchParams();
  if (userId) params.set("user_id", userId);
  if (namespace) params.set("namespace", namespace);
  try {
    return await fetchJson(
      pathsConfig,
      `/v1/working-memory/${encodeURIComponent(sessionId)}${params.toString() ? `?${params.toString()}` : ""}`
    );
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function upsertWorkingMemory(pathsConfig, { id, text, tags, sessionId, userId, namespace }) {
  if (!pathsConfig.amsBaseUrl || !sessionId) {
    return { status: "skipped", reason: "AMS is not configured or session_id is missing" };
  }

  const existing = await getExistingWorkingMemory(pathsConfig, sessionId, userId, namespace);
  const now = new Date().toISOString();
  const payload = {
    messages: [
      ...(existing?.messages ?? []),
      {
        id: `${id}-message`,
        role: "system",
        content: text,
        created_at: now
      }
    ],
    memories: [
      ...(existing?.memories ?? []),
      {
        id,
        text,
        memory_type: "semantic",
        topics: tags ?? [],
        user_id: userId ?? null,
        namespace: namespace ?? null
      }
    ],
    data: existing?.data ?? {},
    context: existing?.context ?? null,
    user_id: userId ?? existing?.user_id ?? null,
    namespace: namespace ?? existing?.namespace ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now
  };

  const response = await fetchJson(pathsConfig, `/v1/working-memory/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  return {
    status: "ok",
    session_id: sessionId,
    message_count: response.messages?.length ?? 0,
    memory_count: response.memories?.length ?? 0
  };
}

async function runPythonBridge(pathsConfig, command, payload = {}) {
  if (!pathsConfig.pythonScript || !fs.existsSync(pathsConfig.pythonScript)) {
    throw new Error(`python bridge script not found: ${pathsConfig.pythonScript}`);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(pathsConfig.pythonBin, [pathsConfig.pythonScript, command], {
      cwd: pathsConfig.root,
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
        env_file: pathsConfig.envFile,
        bridge_config: {
          qdrantUrl: pathsConfig.mem0.qdrantUrl,
          collectionName: pathsConfig.mem0.collectionName,
          embeddingModelDims: pathsConfig.mem0.embeddingModelDims,
          llmModel: pathsConfig.mem0.llmModel,
          embedderModel: pathsConfig.mem0.embedderModel,
          neo4jUrl: pathsConfig.mem0.neo4jUrl,
          neo4jUsername: pathsConfig.mem0.neo4jUsername,
          neo4jDatabase: pathsConfig.mem0.neo4jDatabase,
          enableGraph: pathsConfig.mem0.enableGraph
        }
      })
    );
    child.stdin.end();
  });
}

async function collectLayerSnapshot(pathsConfig, { query, userId, sessionId, namespace, maxResults }) {
  const snapshot = {
    markdown: await searchMarkdown(pathsConfig, query, maxResults),
    staged: [],
    conflicts: [],
    commits: [],
    working: [],
    semantic: [],
    graph: [],
    errors: []
  };

  const localSnapshot = await collectLocalSnapshot(pathsConfig, query, maxResults);
  snapshot.staged = localSnapshot.staged;
  snapshot.conflicts = localSnapshot.conflicts;
  snapshot.commits = localSnapshot.commits;

  const working = await searchWorkingMemory(pathsConfig, query, sessionId, userId, namespace);
  snapshot.working = working.results ?? [];
  if (working.status === "error") {
    snapshot.errors.push({ layer: "working", error: working.error });
  }

  try {
    const mem0Result = await runPythonBridge(pathsConfig, "search", {
      query,
      user_id: userId,
      limit: maxResults
    });
    snapshot.semantic = mem0Result.data?.results ?? [];
    snapshot.graph = mem0Result.data?.relations ?? [];
  } catch (error) {
    snapshot.errors.push({ layer: "semantic-graph", error: error.message });
  }

  return snapshot;
}

function flattenSnapshot(snapshot) {
  const semantic = (snapshot.semantic ?? []).map((item) => ({
    scope: "semantic",
    source: item.id ?? null,
    memory: item.memory,
    score: item.score ?? null
  }));
  const graph = (snapshot.graph ?? []).map((item) => ({
    scope: "graph",
    source: item.source ?? null,
    relationship: item.relationship,
    destination: item.destination ?? item.target ?? null
  }));
  return [
    ...(snapshot.markdown ?? []),
    ...(snapshot.staged ?? []),
    ...(snapshot.conflicts ?? []),
    ...(snapshot.commits ?? []),
    ...(snapshot.working ?? []),
    ...semantic,
    ...graph
  ];
}

function defaultUserId(pathsConfig, params) {
  return params.user_id ?? pathsConfig.defaultUserId ?? null;
}

function defaultSessionId(pathsConfig, params) {
  return params.session_id ?? pathsConfig.defaultSessionId ?? defaultUserId(pathsConfig, params);
}

function defaultNamespace(pathsConfig, params) {
  return params.namespace ?? pathsConfig.defaultNamespace ?? null;
}

export default function register(api) {
  api.registerTool(
    {
      name: "memory_bridge_health",
      description: "Report Markdown, AMS, and mem0/Neo4j bridge readiness.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute() {
        const pathsConfig = getPaths(api);
        const markdownFiles = await collectMarkdownFiles(pathsConfig);
        const result = {
          root: pathsConfig.root,
          markdown_files: markdownFiles,
          staged_dir: pathsConfig.stagedDir,
          conflicts_dir: pathsConfig.conflictsDir,
          commits_dir: pathsConfig.commitsDir,
          python_bridge: {
            python_bin: pathsConfig.pythonBin,
            script: pathsConfig.pythonScript,
            env_file: pathsConfig.envFile
          },
          ams: {
            base_url: pathsConfig.amsBaseUrl
          }
        };

        try {
          result.ams.health = pathsConfig.amsBaseUrl
            ? await fetchJson(pathsConfig, "/v1/health")
            : { status: "skipped", reason: "amsBaseUrl not configured" };
        } catch (error) {
          result.ams.health = { status: "error", error: error.message };
        }

        try {
          result.python_bridge.health = await runPythonBridge(pathsConfig, "health");
        } catch (error) {
          result.python_bridge.health = { status: "error", error: error.message };
        }

        return buildToolText(result);
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "memory_bridge_retrieve",
      description: "Retrieve memory across Markdown, AMS working memory, semantic memory, and graph memory.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          namespace: { type: "string" },
          max_results: { type: "integer", minimum: 1, default: 5 }
        },
        required: ["query"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const pathsConfig = getPaths(api);
        const userId = defaultUserId(pathsConfig, params);
        const sessionId = defaultSessionId(pathsConfig, params);
        const namespace = defaultNamespace(pathsConfig, params);
        const maxResults = params.max_results ?? 5;
        const snapshot = await collectLayerSnapshot(pathsConfig, {
          query: params.query,
          userId,
          sessionId,
          namespace,
          maxResults
        });
        const fusedResults = buildFusedResults(params.query, snapshot, maxResults);

        return buildToolText({
          query: params.query,
          user_id: userId,
          session_id: sessionId,
          namespace,
          markdown: snapshot.markdown,
          staged: snapshot.staged,
          conflicts: snapshot.conflicts,
          commits: snapshot.commits,
          working: snapshot.working,
          semantic: snapshot.semantic,
          graph: snapshot.graph,
          fused_results: fusedResults,
          advisories: buildRetrievalAdvisories(snapshot, fusedResults),
          errors: snapshot.errors
        });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "memory_bridge_stage_fact",
      description: "Stage a candidate fact, write to working memory, and optionally sync to semantic/graph memory.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          source: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          tags: { type: "array", items: { type: "string" } },
          user_id: { type: "string" },
          session_id: { type: "string" },
          namespace: { type: "string" },
          sync_working: { type: "boolean", default: true },
          sync_semantic_graph: { type: "boolean" }
        },
        required: ["text", "source", "confidence"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const pathsConfig = getPaths(api);
        const id = `${Date.now()}-${slugify(params.text) || "fact"}`;
        const userId = defaultUserId(pathsConfig, params);
        const sessionId = defaultSessionId(pathsConfig, params);
        const namespace = defaultNamespace(pathsConfig, params);
        const snapshot = await collectLayerSnapshot(pathsConfig, {
          query: params.text,
          userId,
          sessionId,
          namespace,
          maxResults: 5
        });
        const conflictCandidates = detectConflicts(params.text, flattenSnapshot(snapshot));
        const reviewRequired = conflictCandidates.some((item) => item.review_required);
        const shouldSyncWorking = params.sync_working ?? true;
        const shouldSyncSemanticGraph =
          params.sync_semantic_graph ??
          (
            params.confidence >= pathsConfig.autoSyncConfidence &&
            conflictCandidates.length === 0 &&
            pathsConfig.autoSyncToSemanticGraph
          );

        const backendStatus = {};

        if (shouldSyncWorking) {
          try {
            backendStatus.working = await upsertWorkingMemory(pathsConfig, {
              id,
              text: params.text,
              tags: params.tags ?? [],
              sessionId,
              userId,
              namespace
            });
          } catch (error) {
            backendStatus.working = { status: "error", error: error.message };
          }
        } else {
          backendStatus.working = { status: "skipped" };
        }

        if (shouldSyncSemanticGraph) {
          try {
            backendStatus.semantic_graph = await runPythonBridge(pathsConfig, "add", {
              text: params.text,
              user_id: userId,
              metadata: {
                source: params.source,
                tags: params.tags ?? [],
                namespace
              }
            });
          } catch (error) {
            backendStatus.semantic_graph = { status: "error", error: error.message };
          }
        } else {
          backendStatus.semantic_graph = {
            status: "skipped",
            reason:
              conflictCandidates.length > 0
                ? "conflict detected"
                : "auto sync disabled by policy"
          };
        }

        const payload = {
          id,
          text: params.text,
          source: params.source,
          confidence: params.confidence,
          tags: params.tags ?? [],
          user_id: userId,
          session_id: sessionId,
          namespace,
          staged_at: new Date().toISOString(),
          retrieval_snapshot: snapshot,
          conflict_candidates: conflictCandidates,
          conflict_review_required: reviewRequired,
          backend_status: backendStatus
        };

        const targetDir = reviewRequired ? pathsConfig.conflictsDir : pathsConfig.stagedDir;
        const filePath = await writeJsonRecord(targetDir, id, payload);

        return buildToolText({
          status: reviewRequired ? "conflict" : "staged",
          id,
          file_path: filePath,
          review_required: reviewRequired,
          conflict_candidates: conflictCandidates,
          backend_status: backendStatus
        });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "memory_bridge_commit_fact",
      description: "Commit an approved fact into Markdown truth memory and backfill semantic/graph memory if needed.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          approved_by: { type: "string" },
          target_path: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          namespace: { type: "string" },
          sync_working: { type: "boolean", default: false },
          sync_semantic_graph: { type: "boolean", default: true }
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

        const userId = defaultUserId(pathsConfig, { ...record.payload, ...params });
        const sessionId = defaultSessionId(pathsConfig, { ...record.payload, ...params });
        const namespace = defaultNamespace(pathsConfig, { ...record.payload, ...params });
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

        const backendStatus = { ...(record.payload.backend_status ?? {}) };

        if ((params.sync_working ?? false) && backendStatus.working?.status !== "ok") {
          try {
            backendStatus.working = await upsertWorkingMemory(pathsConfig, {
              id: record.payload.id,
              text: record.payload.text,
              tags: record.payload.tags ?? [],
              sessionId,
              userId,
              namespace
            });
          } catch (error) {
            backendStatus.working = { status: "error", error: error.message };
          }
        }

        if ((params.sync_semantic_graph ?? true) && backendStatus.semantic_graph?.status !== "ok") {
          try {
            backendStatus.semantic_graph = await runPythonBridge(pathsConfig, "add", {
              text: record.payload.text,
              user_id: userId,
              metadata: {
                source: record.payload.source,
                tags: record.payload.tags ?? [],
                namespace
              }
            });
          } catch (error) {
            backendStatus.semantic_graph = { status: "error", error: error.message };
          }
        }

        const commitPath = await writeJsonRecord(pathsConfig.commitsDir, params.id, {
          ...record.payload,
          approved_by: params.approved_by,
          committed_at: new Date().toISOString(),
          target_path: targetPath,
          backend_status: backendStatus
        });
        if (record.filePath !== commitPath) {
          await fsp.rm(record.filePath, { force: true });
        }

        return buildToolText({
          status: "committed",
          id: params.id,
          target_path: targetPath,
          commit_path: commitPath,
          backend_status: backendStatus
        });
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
          notes: { type: "string" },
          resolved_by: { type: "string" }
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
          resolved_by: params.resolved_by ?? null,
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

  api.registerTool(
    {
      name: "memory_bridge_review_conflicts",
      description: "Summarize unresolved memory conflicts and suggest the next human review action.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, default: 10 }
        },
        additionalProperties: false
      },
      async execute(_id, params) {
        const pathsConfig = getPaths(api);
        const records = await readLocalRecordDir(pathsConfig.conflictsDir, "conflict");
        const suggestions = records
          .slice()
          .sort((a, b) => String(b.staged_at ?? "").localeCompare(String(a.staged_at ?? "")))
          .slice(0, params.limit ?? 10)
          .map((record) => {
            const candidates = Array.isArray(record.conflict_candidates) ? record.conflict_candidates : [];
            const hasContradiction = candidates.some((item) => item.relation === "contradiction");
            const hasDuplicate = candidates.every((item) => item.relation === "duplicate");
            const suggestedAction = hasContradiction ? "defer" : hasDuplicate ? "keep" : "merge";
            const reason = hasContradiction
              ? "candidate conflicts with an existing truth-like memory and should wait for human review"
              : hasDuplicate
                ? "candidate mostly duplicates an existing memory and can usually be kept as-is or ignored"
                : "candidate partially overlaps with existing memory and likely needs merge-style consolidation";

            return {
              id: record.id ?? path.basename(record.source ?? "", ".json"),
              source: record.source ?? null,
              staged_at: record.staged_at ?? null,
              confidence: record.confidence ?? null,
              preview: getComparableText(record).slice(0, 240),
              conflict_candidates: candidates.slice(0, 5),
              suggested_action: suggestedAction,
              suggested_reason: reason
            };
          });

        return buildToolText({
          conflict_count: records.length,
          suggestions
        });
      }
    },
    { optional: true }
  );

  api.registerCli(
    ({ program }) => {
      const memoryBridge = program.command("memory-bridge").description("Inspect memory-bridge status.");

      memoryBridge.command("status").action(async () => {
        const pathsConfig = getPaths(api);
        const markdownFiles = await collectMarkdownFiles(pathsConfig);
        const [stagedRecords, conflictRecords, commitRecords] = await Promise.all([
          readLocalRecordDir(pathsConfig.stagedDir, "staged"),
          readLocalRecordDir(pathsConfig.conflictsDir, "conflict"),
          readLocalRecordDir(pathsConfig.commitsDir, "commit")
        ]);
        const result = {
          root: pathsConfig.root,
          markdown_files: markdownFiles,
          staged_dir: pathsConfig.stagedDir,
          conflicts_dir: pathsConfig.conflictsDir,
          commits_dir: pathsConfig.commitsDir,
          local_record_counts: {
            staged: stagedRecords.length,
            conflicts: conflictRecords.length,
            commits: commitRecords.length
          },
          ams_base_url: pathsConfig.amsBaseUrl,
          python_bin: pathsConfig.pythonBin,
          python_script: pathsConfig.pythonScript,
          env_file: pathsConfig.envFile,
          mem0: pathsConfig.mem0
        };

        try {
          result.ams_health = pathsConfig.amsBaseUrl
            ? await fetchJson(pathsConfig, "/v1/health")
            : { status: "skipped" };
        } catch (error) {
          result.ams_health = { status: "error", error: error.message };
        }

        try {
          result.python_bridge_health = await runPythonBridge(pathsConfig, "health");
        } catch (error) {
          result.python_bridge_health = { status: "error", error: error.message };
        }

        console.log(JSON.stringify(result, null, 2));
      });

      memoryBridge
        .command("retrieve")
        .requiredOption("--query <query>")
        .option("--user-id <userId>")
        .option("--session-id <sessionId>")
        .option("--namespace <namespace>")
        .option("--max-results <maxResults>", undefined, "5")
        .action(async (options) => {
          const pathsConfig = getPaths(api);
          const userId = defaultUserId(pathsConfig, { user_id: options.userId });
          const sessionId = defaultSessionId(pathsConfig, { user_id: userId, session_id: options.sessionId });
          const namespace = defaultNamespace(pathsConfig, { namespace: options.namespace });
          const maxResults = Number(options.maxResults || 5);
          const snapshot = await collectLayerSnapshot(pathsConfig, {
            query: options.query,
            userId,
            sessionId,
            namespace,
            maxResults
          });
          const fusedResults = buildFusedResults(options.query, snapshot, maxResults);
          console.log(
            JSON.stringify(
              {
                query: options.query,
                user_id: userId,
                session_id: sessionId,
                namespace,
                markdown: snapshot.markdown,
                staged: snapshot.staged,
                conflicts: snapshot.conflicts,
                commits: snapshot.commits,
                working: snapshot.working,
                semantic: snapshot.semantic,
                graph: snapshot.graph,
                fused_results: fusedResults,
                advisories: buildRetrievalAdvisories(snapshot, fusedResults),
                errors: snapshot.errors
              },
              null,
              2
            )
          );
        });

      memoryBridge
        .command("stage")
        .requiredOption("--text <text>")
        .requiredOption("--source <source>")
        .requiredOption("--confidence <confidence>")
        .option("--tags <tags>")
        .option("--user-id <userId>")
        .option("--session-id <sessionId>")
        .option("--namespace <namespace>")
        .option("--no-sync-working")
        .option("--sync-semantic-graph")
        .action(async (options) => {
          const pathsConfig = getPaths(api);
          const id = `${Date.now()}-${slugify(options.text) || "fact"}`;
          const userId = defaultUserId(pathsConfig, { user_id: options.userId });
          const sessionId = defaultSessionId(pathsConfig, { user_id: userId, session_id: options.sessionId });
          const namespace = defaultNamespace(pathsConfig, { namespace: options.namespace });
          const tags = options.tags
            ? options.tags.split(",").map((item) => item.trim()).filter(Boolean)
            : [];
          const snapshot = await collectLayerSnapshot(pathsConfig, {
            query: options.text,
            userId,
            sessionId,
            namespace,
            maxResults: 5
          });
          const conflictCandidates = detectConflicts(options.text, flattenSnapshot(snapshot));
          const reviewRequired = conflictCandidates.some((item) => item.review_required);
          const confidence = Number(options.confidence);
          const shouldSyncSemanticGraph =
            Boolean(options.syncSemanticGraph) ||
            (
              confidence >= pathsConfig.autoSyncConfidence &&
              conflictCandidates.length === 0 &&
              pathsConfig.autoSyncToSemanticGraph
            );

          const backendStatus = {};
          if (options.syncWorking) {
            try {
              backendStatus.working = await upsertWorkingMemory(pathsConfig, {
                id,
                text: options.text,
                tags,
                sessionId,
                userId,
                namespace
              });
            } catch (error) {
              backendStatus.working = { status: "error", error: error.message };
            }
          } else {
            backendStatus.working = { status: "skipped" };
          }

          if (shouldSyncSemanticGraph) {
            try {
              backendStatus.semantic_graph = await runPythonBridge(pathsConfig, "add", {
                text: options.text,
                user_id: userId,
                metadata: {
                  source: options.source,
                  tags,
                  namespace
                }
              });
            } catch (error) {
              backendStatus.semantic_graph = { status: "error", error: error.message };
            }
          } else {
            backendStatus.semantic_graph = { status: "skipped" };
          }

          const payload = {
            id,
            text: options.text,
            source: options.source,
            confidence,
            tags,
            user_id: userId,
            session_id: sessionId,
            namespace,
            staged_at: new Date().toISOString(),
            retrieval_snapshot: snapshot,
            conflict_candidates: conflictCandidates,
            conflict_review_required: reviewRequired,
            backend_status: backendStatus
          };
          const targetDir = reviewRequired ? pathsConfig.conflictsDir : pathsConfig.stagedDir;
          const filePath = await writeJsonRecord(targetDir, id, payload);
          console.log(
            JSON.stringify(
              {
                status: reviewRequired ? "conflict" : "staged",
                id,
                file_path: filePath,
                review_required: reviewRequired,
                conflict_candidates: conflictCandidates,
                backend_status: backendStatus
              },
              null,
              2
            )
          );
        });

      memoryBridge
        .command("commit")
        .requiredOption("--id <id>")
        .requiredOption("--approved-by <approvedBy>")
        .option("--target-path <targetPath>")
        .option("--user-id <userId>")
        .option("--session-id <sessionId>")
        .option("--namespace <namespace>")
        .option("--sync-working")
        .option("--no-sync-semantic-graph")
        .action(async (options) => {
          const pathsConfig = getPaths(api);
          const record = await readRecordById(pathsConfig, options.id);
          if (!record) {
            console.log(JSON.stringify({ status: "missing", id: options.id }, null, 2));
            return;
          }

          const userId = defaultUserId(pathsConfig, { ...record.payload, user_id: options.userId });
          const sessionId = defaultSessionId(pathsConfig, {
            ...record.payload,
            user_id: userId,
            session_id: options.sessionId
          });
          const namespace = defaultNamespace(pathsConfig, {
            ...record.payload,
            namespace: options.namespace
          });
          const targetPath =
            options.targetPath != null
              ? path.resolve(pathsConfig.root, options.targetPath)
              : path.join(pathsConfig.root, "workspace-main", "MEMORY.md");

          const textBlock =
            `${record.payload.text}\n` +
            `  - source: ${record.payload.source}\n` +
            `  - confidence: ${record.payload.confidence}\n` +
            `  - approved_by: ${options.approvedBy}\n` +
            `  - committed_at: ${new Date().toISOString()}`;
          await appendToMarkdown(targetPath, textBlock);

          const backendStatus = { ...(record.payload.backend_status ?? {}) };
          if (options.syncWorking) {
            try {
              backendStatus.working = await upsertWorkingMemory(pathsConfig, {
                id: record.payload.id,
                text: record.payload.text,
                tags: record.payload.tags ?? [],
                sessionId,
                userId,
                namespace
              });
            } catch (error) {
              backendStatus.working = { status: "error", error: error.message };
            }
          }
          if (options.syncSemanticGraph !== false && backendStatus.semantic_graph?.status !== "ok") {
            try {
              backendStatus.semantic_graph = await runPythonBridge(pathsConfig, "add", {
                text: record.payload.text,
                user_id: userId,
                metadata: {
                  source: record.payload.source,
                  tags: record.payload.tags ?? [],
                  namespace
                }
              });
            } catch (error) {
              backendStatus.semantic_graph = { status: "error", error: error.message };
            }
          }

          const commitPath = await writeJsonRecord(pathsConfig.commitsDir, options.id, {
            ...record.payload,
            approved_by: options.approvedBy,
            committed_at: new Date().toISOString(),
            target_path: targetPath,
            backend_status: backendStatus
          });
          if (record.filePath !== commitPath) {
            await fsp.rm(record.filePath, { force: true });
          }

          console.log(
            JSON.stringify(
              {
                status: "committed",
                id: options.id,
                target_path: targetPath,
                commit_path: commitPath,
                backend_status: backendStatus
              },
              null,
              2
            )
          );
        });

      memoryBridge
        .command("review-conflicts")
        .option("--limit <limit>", undefined, "10")
        .action(async (options) => {
          const pathsConfig = getPaths(api);
          const records = await readLocalRecordDir(pathsConfig.conflictsDir, "conflict");
          const suggestions = records
            .slice()
            .sort((a, b) => String(b.staged_at ?? "").localeCompare(String(a.staged_at ?? "")))
            .slice(0, Number(options.limit || 10))
            .map((record) => {
              const candidates = Array.isArray(record.conflict_candidates) ? record.conflict_candidates : [];
              const hasContradiction = candidates.some((item) => item.relation === "contradiction");
              const hasDuplicate = candidates.length > 0 && candidates.every((item) => item.relation === "duplicate");
              return {
                id: record.id ?? path.basename(record.source ?? "", ".json"),
                source: record.source ?? null,
                staged_at: record.staged_at ?? null,
                confidence: record.confidence ?? null,
                preview: getComparableText(record).slice(0, 240),
                suggested_action: hasContradiction ? "defer" : hasDuplicate ? "keep" : "merge",
                conflict_candidates: candidates.slice(0, 5)
              };
            });

          console.log(
            JSON.stringify(
              {
                conflict_count: records.length,
                suggestions
              },
              null,
              2
            )
          );
        });

      memoryBridge
        .command("resolve-conflict")
        .requiredOption("--id <id>")
        .requiredOption("--action <action>")
        .option("--notes <notes>")
        .option("--resolved-by <resolvedBy>")
        .action(async (options) => {
          const pathsConfig = getPaths(api);
          const record = await readRecordById(pathsConfig, options.id);
          if (!record) {
            console.log(JSON.stringify({ status: "missing", id: options.id }, null, 2));
            return;
          }

          const destinationDir =
            options.action === "defer" ? pathsConfig.conflictsDir : pathsConfig.commitsDir;
          const filePath = await writeJsonRecord(destinationDir, options.id, {
            ...record.payload,
            resolution_action: options.action,
            resolution_notes: options.notes ?? "",
            resolved_by: options.resolvedBy ?? null,
            resolved_at: new Date().toISOString()
          });
          if (record.filePath !== filePath) {
            await fsp.rm(record.filePath, { force: true });
          }

          console.log(
            JSON.stringify(
              {
                status: "resolved",
                id: options.id,
                action: options.action,
                file_path: filePath
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
