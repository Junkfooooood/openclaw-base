import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const EVOLUTION_START_MARKER = "<!-- OPENCLAW: SOP_EVOLUTION_START -->";
const EVOLUTION_END_MARKER = "<!-- OPENCLAW: SOP_EVOLUTION_END -->";

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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

function getPaths(root) {
  const baseDir = path.join(root, "shared", "runtime", "sop_evolution");
  return {
    baseDir,
    signalsDir: path.join(baseDir, "signals"),
    reportsDir: path.join(baseDir, "reports"),
    draftsDir: path.join(baseDir, "drafts"),
    shadowDir: path.join(baseDir, "shadow_tests"),
    activationsDir: path.join(baseDir, "activations"),
    sopActiveDir: path.join(root, "shared", "sop", "active"),
    sopArchiveDir: path.join(root, "shared", "sop", "archive")
  };
}

async function ensureDirs(pathsConfig) {
  for (const dir of [
    pathsConfig.baseDir,
    pathsConfig.signalsDir,
    pathsConfig.reportsDir,
    pathsConfig.draftsDir,
    pathsConfig.shadowDir,
    pathsConfig.activationsDir,
    pathsConfig.sopArchiveDir
  ]) {
    await fsp.mkdir(dir, { recursive: true });
  }
}

async function writeJson(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${text.trimEnd()}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function listJsonFiles(dir) {
  try {
    const entries = await fsp.readdir(dir);
    return entries.filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const item of values) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    const normalized = normalizeText(text);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(text);
  }
  return result;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { attributes: {}, body: raw };
  const endIndex = raw.indexOf("\n---\n", 4);
  if (endIndex === -1) return { attributes: {}, body: raw };

  const header = raw.slice(4, endIndex).split("\n");
  const attributes = {};
  let activeListKey = null;

  for (const line of header) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && activeListKey) {
      if (!Array.isArray(attributes[activeListKey])) {
        attributes[activeListKey] = [];
      }
      attributes[activeListKey].push(listMatch[1].trim());
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kvMatch) {
      activeListKey = null;
      continue;
    }

    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();
    if (!value) {
      attributes[key] = [];
      activeListKey = key;
      continue;
    }

    attributes[key] = value;
    activeListKey = null;
  }

  return {
    attributes,
    body: raw.slice(endIndex + 5)
  };
}

function getTitleFromBody(body, fallback) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

async function listActiveSops(root) {
  const pathsConfig = getPaths(root);
  let entries = [];
  try {
    entries = (await fsp.readdir(pathsConfig.sopActiveDir)).filter((entry) => entry.endsWith(".md")).sort();
  } catch {
    return [];
  }

  const result = [];
  for (const entry of entries) {
    const filePath = path.join(pathsConfig.sopActiveDir, entry);
    const raw = await fsp.readFile(filePath, "utf8");
    const { attributes, body } = parseFrontmatter(raw);
    result.push({
      id: String(attributes.id ?? path.basename(entry, ".md")),
      status: String(attributes.status ?? "unknown"),
      file_path: filePath,
      title: getTitleFromBody(body, path.basename(entry, ".md"))
    });
  }
  return result;
}

async function resolveSopTarget(root, sopId, targetPath = null) {
  const activeSops = await listActiveSops(root);
  if (targetPath) {
    const resolved = path.isAbsolute(targetPath) ? targetPath : path.join(root, targetPath);
    const existing = activeSops.find((item) => item.file_path === resolved);
    return existing ?? { id: sopId ?? path.basename(resolved, ".md"), file_path: resolved, title: path.basename(resolved) };
  }

  const normalizedId = normalizeText(sopId);
  const byId = activeSops.find((item) => normalizeText(item.id) === normalizedId);
  if (byId) return byId;

  const byBasename = activeSops.find((item) => {
    const base = path.basename(item.file_path, ".md");
    return normalizeText(base) === normalizedId || slugify(base) === slugify(sopId);
  });
  if (byBasename) return byBasename;

  return { id: sopId, file_path: null, title: sopId };
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractReviewEnvelope(payload, depth = 0) {
  if (payload == null || depth > 4) return null;

  if (typeof payload === "string") {
    const parsed = safeJsonParse(payload);
    return parsed ? extractReviewEnvelope(parsed, depth + 1) : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const match = extractReviewEnvelope(item, depth + 1);
      if (match) return match;
    }
    return null;
  }

  if (typeof payload !== "object") return null;

  if (typeof payload.status === "string") {
    const advisories = Array.isArray(payload.advisories)
      ? payload.advisories.map((item) => String(item))
      : [];
    const failedChecks = Array.isArray(payload.failed_checks)
      ? payload.failed_checks.map((item) => String(item))
      : [];

    return {
      status: String(payload.status).toUpperCase(),
      reason: String(payload.reason ?? payload.summary ?? "").trim(),
      advisories,
      failed_checks: failedChecks,
      suggested_next_step: String(payload.suggested_next_step ?? payload.next_step ?? "").trim()
    };
  }

  for (const key of ["detail", "result", "validation", "payload", "data", "stdout", "content"]) {
    if (!(key in payload)) continue;
    const match = extractReviewEnvelope(payload[key], depth + 1);
    if (match) return match;
  }

  return null;
}

export async function captureEvolutionSignal(root, input) {
  const pathsConfig = getPaths(root);
  await ensureDirs(pathsConfig);

  const target = await resolveSopTarget(root, input.sop_id, input.target_path ?? null);
  const capturedAt = new Date().toISOString();
  const id =
    input.id ??
    `${Date.now()}-${slugify(input.sop_id || target.id || "sop")}-${slugify(
      input.summary || input.status || "signal"
    )}`;

  const signal = {
    id,
    sop_id: String(input.sop_id ?? target.id),
    target_path: target.file_path ?? input.target_path ?? null,
    target_title: target.title ?? null,
    source_kind: String(input.source_kind ?? "manual"),
    source_path: input.source_path ? path.resolve(root, input.source_path) : null,
    status: String(input.status ?? "PASS").toUpperCase(),
    summary: String(input.summary ?? "").trim(),
    advisories: uniqueStrings(input.advisories),
    failed_checks: uniqueStrings(input.failed_checks),
    suggested_next_step: String(input.suggested_next_step ?? "").trim(),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    captured_at: capturedAt
  };

  const filePath = path.join(pathsConfig.signalsDir, `${id}.json`);
  await writeJson(filePath, signal);
  return {
    status: "captured",
    signal,
    file_path: filePath
  };
}

export async function ingestReviewSignal(root, filePath, options = {}) {
  const resolvedPath = path.resolve(root, filePath);
  const payload = await readJson(resolvedPath);
  const envelope = extractReviewEnvelope(payload);
  if (!envelope) {
    throw new Error(`could not extract review envelope from ${resolvedPath}`);
  }

  return captureEvolutionSignal(root, {
    sop_id: options.sop_id,
    target_path: options.target_path ?? null,
    source_kind: options.source_kind ?? "review",
    source_path: resolvedPath,
    status: envelope.status,
    summary: envelope.reason || `review result for ${path.basename(resolvedPath)}`,
    advisories: envelope.advisories,
    failed_checks: envelope.failed_checks,
    suggested_next_step: envelope.suggested_next_step,
    metadata: options.metadata ?? {}
  });
}

async function loadSignalsForSop(root, sopId) {
  const pathsConfig = getPaths(root);
  const files = await listJsonFiles(pathsConfig.signalsDir);
  const signals = [];

  for (const entry of files) {
    const filePath = path.join(pathsConfig.signalsDir, entry);
    const payload = await readJson(filePath);
    if (normalizeText(payload.sop_id) !== normalizeText(sopId)) continue;
    signals.push(payload);
  }

  return signals.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
}

function accumulateTextBucket(map, text, signal) {
  const normalized = normalizeText(text);
  if (!normalized) return;

  if (!map.has(normalized)) {
    map.set(normalized, {
      text: String(text).trim(),
      count: 0,
      first_seen: signal.captured_at,
      last_seen: signal.captured_at,
      signal_ids: []
    });
  }

  const bucket = map.get(normalized);
  bucket.count += 1;
  bucket.last_seen = signal.captured_at;
  bucket.signal_ids.push(signal.id);
}

function renderLearningBullet(entry, kind) {
  const lower = normalizeText(entry.text);

  if (lower.includes("logs")) {
    return "若对话涉及学习进展、阻塞、节奏变化或值得回顾的判断，应先检查是否至少需要一条 `logs`；缺失时默认给 advisory，而不是直接 FAIL。";
  }
  if (lower.includes("source_summary")) {
    return "route review 输入若条件允许，应附带 `source_summary`，方便后续比较、复盘与 SOP 收敛。";
  }
  if (lower.includes("duplicate") || lower.includes("重复")) {
    return "若同一 route 被重复使用，应说明拆分边界，避免多个同名 route 无区分并列。";
  }
  if (kind === "failed_check") {
    return `重复失败信号：${entry.text}；后续正式执行前应把该项纳入自检。`;
  }
  return `重复 advisory：${entry.text}；后续 route 判断时应将其纳入默认自检。`;
}

function dedupeBullets(values) {
  const seen = new Set();
  const bullets = [];
  for (const item of values) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    const normalized = normalizeText(text);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    bullets.push(text);
  }
  return bullets;
}

function renderReportMarkdown(report) {
  const advisoryLines =
    report.recurring_advisories.length > 0
      ? report.recurring_advisories.map((item) => `- (${item.count}) ${item.text}`).join("\n")
      : "- none";
  const failureLines =
    report.recurring_failed_checks.length > 0
      ? report.recurring_failed_checks.map((item) => `- (${item.count}) ${item.text}`).join("\n")
      : "- none";
  const bulletLines =
    report.proposed_runtime_learnings.length > 0
      ? report.proposed_runtime_learnings.map((item) => `- ${item}`).join("\n")
      : "- none";

  return `# SOP Evolution Report

- sop_id: ${report.sop_id}
- target_path: ${report.target_path ?? "unknown"}
- signal_count: ${report.signal_count}
- generated_at: ${report.generated_at}
- min_occurrences: ${report.min_occurrences}

## Status Counts

\`\`\`json
${JSON.stringify(report.status_counts, null, 2)}
\`\`\`

## Recurring Advisories

${advisoryLines}

## Recurring Failed Checks

${failureLines}

## Proposed Runtime Learnings

${bulletLines}
`;
}

export async function aggregateEvolutionSignals(root, { sop_id, min_occurrences = 2 } = {}) {
  if (!sop_id) {
    throw new Error("aggregate requires sop_id");
  }

  const pathsConfig = getPaths(root);
  await ensureDirs(pathsConfig);
  const signals = await loadSignalsForSop(root, sop_id);
  const advisoryMap = new Map();
  const failureMap = new Map();
  const statusCounts = {};

  for (const signal of signals) {
    statusCounts[signal.status] = (statusCounts[signal.status] ?? 0) + 1;
    for (const advisory of signal.advisories ?? []) {
      accumulateTextBucket(advisoryMap, advisory, signal);
    }
    for (const failedCheck of signal.failed_checks ?? []) {
      accumulateTextBucket(failureMap, failedCheck, signal);
    }
  }

  const recurringAdvisories = [...advisoryMap.values()]
    .filter((item) => item.count >= min_occurrences)
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  const recurringFailures = [...failureMap.values()]
    .filter((item) => item.count >= min_occurrences)
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  const target = await resolveSopTarget(root, sop_id, null);
  const reportId = `${Date.now()}-${slugify(sop_id)}-aggregate`;
  const report = {
    report_id: reportId,
    sop_id,
    target_path: target.file_path ?? null,
    target_title: target.title ?? null,
    signal_count: signals.length,
    generated_at: new Date().toISOString(),
    min_occurrences,
    status_counts: statusCounts,
    recurring_advisories: recurringAdvisories,
    recurring_failed_checks: recurringFailures,
    proposed_runtime_learnings: dedupeBullets([
      ...recurringAdvisories.map((item) => renderLearningBullet(item, "advisory")),
      ...recurringFailures.map((item) => renderLearningBullet(item, "failed_check"))
    ]),
    source_signal_ids: signals.map((item) => item.id)
  };

  const reportJsonPath = path.join(pathsConfig.reportsDir, `${reportId}.json`);
  const reportMarkdownPath = path.join(pathsConfig.reportsDir, `${reportId}.md`);
  await writeJson(reportJsonPath, report);
  await writeText(reportMarkdownPath, renderReportMarkdown(report));

  return {
    status: "aggregated",
    report,
    report_path: reportJsonPath,
    report_markdown_path: reportMarkdownPath
  };
}

async function loadLatestReport(root, sopId) {
  const pathsConfig = getPaths(root);
  const files = await listJsonFiles(pathsConfig.reportsDir);
  const candidates = [];

  for (const entry of files) {
    const filePath = path.join(pathsConfig.reportsDir, entry);
    const payload = await readJson(filePath);
    if (normalizeText(payload.sop_id) !== normalizeText(sopId)) continue;
    candidates.push({ filePath, payload });
  }

  candidates.sort((a, b) => String(a.payload.generated_at).localeCompare(String(b.payload.generated_at)));
  return candidates.at(-1) ?? null;
}

function renderManagedSection(report) {
  const bullets =
    report.proposed_runtime_learnings.length > 0
      ? report.proposed_runtime_learnings
      : ["暂无足够重复信号，继续保留人工观察。"];

  return `# Runtime Learnings

${EVOLUTION_START_MARKER}
本节由 SOP 自进化工作流维护。

- updated_at: ${report.generated_at}
- source_signal_count: ${report.signal_count}
- min_occurrences: ${report.min_occurrences}
${bullets.map((item) => `- ${item}`).join("\n")}
${EVOLUTION_END_MARKER}`;
}

function renderDraftMarkdown(draft) {
  const bulletLines =
    draft.proposed_runtime_learnings.length > 0
      ? draft.proposed_runtime_learnings.map((item) => `- ${item}`).join("\n")
      : "- none";

  return `# SOP Evolution Draft

- draft_id: ${draft.draft_id}
- sop_id: ${draft.sop_id}
- target_path: ${draft.target_path ?? "unknown"}
- report_id: ${draft.report_id}
- generated_at: ${draft.generated_at}

## Proposed Runtime Learnings

${bulletLines}

## Managed Section Preview

\`\`\`md
${draft.managed_section}
\`\`\`
`;
}

export async function createEvolutionDraft(root, { sop_id, report_id = null } = {}) {
  if (!sop_id) {
    throw new Error("draft-update requires sop_id");
  }

  const pathsConfig = getPaths(root);
  await ensureDirs(pathsConfig);

  let reportEntry = null;
  if (report_id) {
    const filePath = path.join(pathsConfig.reportsDir, `${report_id}.json`);
    reportEntry = { filePath, payload: await readJson(filePath) };
  } else {
    reportEntry = await loadLatestReport(root, sop_id);
  }

  if (!reportEntry) {
    throw new Error(`no report found for sop_id=${sop_id}`);
  }

  const report = reportEntry.payload;
  const target = await resolveSopTarget(root, sop_id, report.target_path);
  const draftId = `${Date.now()}-${slugify(sop_id)}-draft`;
  const draft = {
    draft_id: draftId,
    sop_id,
    target_path: target.file_path ?? report.target_path ?? null,
    target_title: target.title ?? report.target_title ?? null,
    report_id: report.report_id,
    generated_at: new Date().toISOString(),
    proposed_runtime_learnings: report.proposed_runtime_learnings ?? [],
    managed_section: renderManagedSection(report)
  };

  const draftJsonPath = path.join(pathsConfig.draftsDir, `${draftId}.json`);
  const draftMarkdownPath = path.join(pathsConfig.draftsDir, `${draftId}.md`);
  await writeJson(draftJsonPath, draft);
  await writeText(draftMarkdownPath, renderDraftMarkdown(draft));

  return {
    status: "drafted",
    draft,
    draft_path: draftJsonPath,
    draft_markdown_path: draftMarkdownPath
  };
}

async function loadDraft(root, draftId) {
  const pathsConfig = getPaths(root);
  const filePath = path.join(pathsConfig.draftsDir, `${draftId}.json`);
  return {
    filePath,
    payload: await readJson(filePath)
  };
}

function extractManagedBullets(section) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line && !line.startsWith("updated_at:") && !line.startsWith("source_signal_count:") && !line.startsWith("min_occurrences:"));
}

export async function shadowTestDraft(root, { draft_id } = {}) {
  if (!draft_id) {
    throw new Error("shadow-test requires draft_id");
  }

  const pathsConfig = getPaths(root);
  await ensureDirs(pathsConfig);
  const { payload: draft } = await loadDraft(root, draft_id);
  const checks = [];
  const targetPath = draft.target_path ? path.resolve(draft.target_path) : null;
  const activeRoot = path.resolve(pathsConfig.sopActiveDir);

  if (!targetPath) {
    checks.push("draft target_path is missing");
  } else if (!targetPath.startsWith(`${activeRoot}${path.sep}`)) {
    checks.push("draft target_path must stay inside shared/sop/active");
  } else if (!fs.existsSync(targetPath)) {
    checks.push("draft target_path does not exist");
  }

  if (!draft.managed_section?.includes(EVOLUTION_START_MARKER)) {
    checks.push("managed section is missing start marker");
  }
  if (!draft.managed_section?.includes(EVOLUTION_END_MARKER)) {
    checks.push("managed section is missing end marker");
  }

  const bullets = extractManagedBullets(draft.managed_section ?? "");
  if (bullets.length === 0) {
    checks.push("managed section must contain at least one runtime learning bullet");
  }

  const uniqueBulletCount = new Set(bullets.map((item) => normalizeText(item))).size;
  if (uniqueBulletCount !== bullets.length) {
    checks.push("managed section contains duplicate runtime learning bullets");
  }

  const result = {
    draft_id,
    target_path: targetPath,
    checked_at: new Date().toISOString(),
    bullet_count: bullets.length,
    status: checks.length === 0 ? "PASS" : "FAIL",
    failed_checks: checks
  };

  const filePath = path.join(pathsConfig.shadowDir, `${draft_id}.json`);
  await writeJson(filePath, result);
  return {
    status: "shadow-tested",
    result,
    file_path: filePath
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertManagedSection(raw, managedSection) {
  const blockPattern = new RegExp(
    `#{1,2}\\s+Runtime Learnings\\s*\\n\\n${escapeRegExp(EVOLUTION_START_MARKER)}[\\s\\S]*?${escapeRegExp(EVOLUTION_END_MARKER)}`,
    "m"
  );
  if (blockPattern.test(raw)) {
    return raw.replace(blockPattern, managedSection.trim());
  }

  const genericPattern = new RegExp(
    `${escapeRegExp(EVOLUTION_START_MARKER)}[\\s\\S]*?${escapeRegExp(EVOLUTION_END_MARKER)}`,
    "m"
  );
  if (genericPattern.test(raw)) {
    return raw.replace(genericPattern, managedSection.trim());
  }

  return `${raw.trimEnd()}\n\n${managedSection.trim()}\n`;
}

async function loadShadowResult(root, draftId) {
  const pathsConfig = getPaths(root);
  const filePath = path.join(pathsConfig.shadowDir, `${draftId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

export async function activateDraft(root, { draft_id, approved_by } = {}) {
  if (!draft_id || !approved_by) {
    throw new Error("activate requires draft_id and approved_by");
  }

  const pathsConfig = getPaths(root);
  await ensureDirs(pathsConfig);
  const shadow = await loadShadowResult(root, draft_id);
  if (!shadow || shadow.status !== "PASS") {
    throw new Error("draft must pass shadow-test before activation");
  }

  const { payload: draft } = await loadDraft(root, draft_id);
  const targetPath = path.resolve(draft.target_path);
  const current = await fsp.readFile(targetPath, "utf8");
  const updated = upsertManagedSection(current, draft.managed_section);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(
    pathsConfig.sopArchiveDir,
    `${path.basename(targetPath, ".md")}-${timestamp}.md`
  );

  await writeText(archivePath, current);
  await writeText(targetPath, updated);

  const activation = {
    activation_id: `${Date.now()}-${slugify(draft.sop_id)}-activation`,
    draft_id,
    sop_id: draft.sop_id,
    target_path: targetPath,
    archive_path: archivePath,
    approved_by,
    activated_at: new Date().toISOString()
  };

  const activationPath = path.join(pathsConfig.activationsDir, `${activation.activation_id}.json`);
  await writeJson(activationPath, activation);

  return {
    status: "activated",
    activation,
    file_path: activationPath
  };
}

export async function runEvolutionLoop(root, { sop_id, min_occurrences = 2 } = {}) {
  const aggregate = await aggregateEvolutionSignals(root, { sop_id, min_occurrences });
  const draft = await createEvolutionDraft(root, {
    sop_id,
    report_id: aggregate.report.report_id
  });
  const shadow = await shadowTestDraft(root, { draft_id: draft.draft.draft_id });

  return {
    status: "loop_ready",
    aggregate,
    draft,
    shadow
  };
}
