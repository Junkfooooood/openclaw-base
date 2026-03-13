import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const DEFAULT_COLLECTOR_HOST = os.hostname().endsWith(".local")
  ? os.hostname()
  : `${os.hostname()}.local`;

const CHROMIUM_BROWSERS = [
  {
    id: "chrome",
    label: "Google Chrome",
    historyPath: path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default/History")
  },
  {
    id: "arc",
    label: "Arc",
    historyPath: path.join(os.homedir(), "Library/Application Support/Arc/User Data/Default/History")
  },
  {
    id: "brave",
    label: "Brave",
    historyPath: path.join(
      os.homedir(),
      "Library/Application Support/BraveSoftware/Brave-Browser/Default/History"
    )
  },
  {
    id: "edge",
    label: "Microsoft Edge",
    historyPath: path.join(
      os.homedir(),
      "Library/Application Support/Microsoft Edge/Default/History"
    )
  }
];

const SAFARI_BROWSERS = [
  {
    id: "safari",
    label: "Safari",
    historyPath: path.join(os.homedir(), "Library/Safari/History.db")
  }
];

const DEFAULT_CONFIG = {
  lookbackDays: 3,
  lookbackHoursForApps: 24,
  paths: {
    root: "shared/runtime/remote_ops",
    outbox: "shared/runtime/remote_ops/outbox",
    inbox: "shared/runtime/remote_ops/inbox",
    exports: "shared/runtime/remote_ops/export",
    state: "shared/runtime/remote_ops/state"
  },
  browser: {
    maxRowsPerBrowser: 3000,
    maxSitesPerCategory: 12,
    agentDomains: [
      "chat.openai.com",
      "chatgpt.com",
      "claude.ai",
      "gemini.google.com",
      "poe.com",
      "kimi.moonshot.cn",
      "yuanbao.tencent.com",
      "chat.deepseek.com",
      "www.doubao.com",
      "www.perplexity.ai"
    ],
    courseDomains: [
      "www.coursera.org",
      "www.edx.org",
      "ocw.mit.edu",
      "www.udemy.com",
      "www.bilibili.com",
      "www.xuetangx.com",
      "www.icourse163.org",
      "www.boya.chaoxing.com",
      "classroom.google.com",
      "www.khanacademy.org",
      "www.notion.so"
    ]
  },
  ssh: {
    collectorHost: DEFAULT_COLLECTOR_HOST,
    collectorUser: os.userInfo().username,
    remoteRoot: "~/.openclaw",
    dashboardLocalPort: 18790,
    dashboardRemotePort: 18789
  },
  export: {
    obsidianDraftSubdir: "RemoteHub",
    maxRecentTasks: 8,
    maxRecentChatlogs: 6
  },
  notifications: {
    defaultChannel: "feishu",
    onlyIfAlert: false,
    staleSnapshotHours: 12
  }
};

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? structuredClone(base) : override;
  }
  const output = Array.isArray(base) ? [...base] : { ...(base ?? {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = deepMerge(output[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, "openclaw.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not locate project root from current directory.");
    }
    current = parent;
  }
}

export async function loadRemoteOpsConfig(root) {
  const configPath = path.join(root, "shared/runtime/remote_ops/config.json");
  const openclawPath = path.join(root, "openclaw.json");
  const openclawConfig = JSON.parse(await fsp.readFile(openclawPath, "utf8"));
  let config = structuredClone(DEFAULT_CONFIG);
  if (fs.existsSync(configPath)) {
    const override = JSON.parse(await fsp.readFile(configPath, "utf8"));
    config = deepMerge(config, override);
  }
  config.runtime = {
    root,
    openclawPath,
    openclawConfig,
    dashboardToken: openclawConfig?.gateway?.auth?.token ?? null,
    dashboardPort: Number(openclawConfig?.gateway?.port ?? 18789),
    heartbeat: openclawConfig?.agents?.defaults?.heartbeat ?? null,
    obsidianConfig: openclawConfig?.plugins?.entries?.["obsidian-bridge"]?.config ?? null
  };
  config.ssh.collectorHost ||= DEFAULT_COLLECTOR_HOST;
  config.ssh.collectorUser ||= os.userInfo().username;
  config.ssh.dashboardRemotePort ||= config.runtime.dashboardPort;
  return config;
}

function ensureDir(target) {
  return fsp.mkdir(target, { recursive: true });
}

function normalizeHostname(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function makeDomainMatcher(domains) {
  const normalized = domains.map((entry) => String(entry).replace(/^www\./, "").toLowerCase());
  return (host) =>
    normalized.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function truncate(value, maxChars = 120) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1)}…`;
}

function parseJsonFromMixedOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const objectStart = trimmed.lastIndexOf("\n{");
  const arrayStart = trimmed.lastIndexOf("\n[");
  const startIndex = Math.max(objectStart, arrayStart);
  const candidate = startIndex >= 0 ? trimmed.slice(startIndex + 1) : trimmed;
  return JSON.parse(candidate);
}

async function runSqliteJson(dbPath, sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 8 * 1024 * 1024
  });
  if (!stdout.trim()) {
    return [];
  }
  return JSON.parse(stdout);
}

function chromiumQuery(lookbackDays, maxRows) {
  const thresholdMicroseconds =
    Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) * 1000) + 11644473600000000;
  return `
    SELECT
      urls.url AS url,
      urls.title AS title,
      datetime((visits.visit_time / 1000000) - 11644473600, 'unixepoch') AS visited_at,
      visits.visit_time AS visited_at_raw
    FROM visits
    JOIN urls ON urls.id = visits.url
    WHERE visits.visit_time >= ${thresholdMicroseconds}
    ORDER BY visits.visit_time DESC
    LIMIT ${maxRows};
  `;
}

function safariQuery(lookbackDays, maxRows) {
  const thresholdSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60 - 978307200;
  return `
    SELECT
      history_items.url AS url,
      COALESCE(history_visits.title, history_items.title, '') AS title,
      datetime(history_visits.visit_time + 978307200, 'unixepoch') AS visited_at,
      history_visits.visit_time AS visited_at_raw
    FROM history_visits
    JOIN history_items ON history_items.id = history_visits.history_item
    WHERE history_visits.visit_time >= ${thresholdSeconds}
    ORDER BY history_visits.visit_time DESC
    LIMIT ${maxRows};
  `;
}

function summarizeHistoryRows(rows, browserId, browserLabel, config) {
  const isAgentDomain = makeDomainMatcher(config.browser.agentDomains);
  const isCourseDomain = makeDomainMatcher(config.browser.courseDomains);
  const grouped = new Map();
  let totalVisits = 0;

  for (const row of rows) {
    const host = normalizeHostname(row.url);
    if (!host) {
      continue;
    }
    totalVisits += 1;
    let category = "other";
    if (isAgentDomain(host)) {
      category = "agent";
    } else if (isCourseDomain(host)) {
      category = "course";
    }
    const key = `${category}:${host}`;
    const current = grouped.get(key) ?? {
      browser: browserLabel,
      browser_id: browserId,
      category,
      domain: host,
      visit_count: 0,
      last_visited_at: null,
      sample_titles: []
    };
    current.visit_count += 1;
    current.last_visited_at = current.last_visited_at
      ? current.last_visited_at > row.visited_at
        ? current.last_visited_at
        : row.visited_at
      : row.visited_at;
    if (row.title && current.sample_titles.length < 3) {
      const title = truncate(row.title, 90);
      if (!current.sample_titles.includes(title)) {
        current.sample_titles.push(title);
      }
    }
    grouped.set(key, current);
  }

  const byCategory = {
    agent: [],
    course: [],
    other: []
  };
  for (const item of grouped.values()) {
    byCategory[item.category].push(item);
  }
  for (const category of Object.keys(byCategory)) {
    byCategory[category].sort((a, b) => b.visit_count - a.visit_count || String(b.last_visited_at).localeCompare(String(a.last_visited_at)));
    byCategory[category] = byCategory[category].slice(0, config.browser.maxSitesPerCategory);
  }

  return {
    browser_id: browserId,
    browser: browserLabel,
    total_visits: totalVisits,
    categories: byCategory
  };
}

async function collectBrowserForProfile(profile, queryBuilder, config) {
  if (!fs.existsSync(profile.historyPath)) {
    return {
      browser_id: profile.id,
      browser: profile.label,
      available: false,
      error: "history database not found",
      total_visits: 0,
      categories: { agent: [], course: [], other: [] }
    };
  }
  try {
    const databaseUri = `${pathToFileURL(profile.historyPath).toString()}?immutable=1`;
    const rows = await runSqliteJson(databaseUri, queryBuilder(config.lookbackDays, config.browser.maxRowsPerBrowser));
    return {
      available: true,
      error: null,
      ...summarizeHistoryRows(rows, profile.id, profile.label, config)
    };
  } catch (error) {
    return {
      browser_id: profile.id,
      browser: profile.label,
      available: false,
      error: error.stderr?.trim() || error.message,
      total_visits: 0,
      categories: { agent: [], course: [], other: [] }
    };
  }
}

export async function collectBrowserUsage(config) {
  const results = [];
  for (const profile of CHROMIUM_BROWSERS) {
    results.push(await collectBrowserForProfile(profile, chromiumQuery, config));
  }
  for (const profile of SAFARI_BROWSERS) {
    results.push(await collectBrowserForProfile(profile, safariQuery, config));
  }
  const aggregate = {
    total_visits: results.reduce((sum, item) => sum + Number(item.total_visits ?? 0), 0),
    agent_sites: [],
    course_sites: [],
    other_sites: []
  };
  for (const item of results) {
    aggregate.agent_sites.push(...item.categories.agent);
    aggregate.course_sites.push(...item.categories.course);
    aggregate.other_sites.push(...item.categories.other);
  }
  for (const key of ["agent_sites", "course_sites", "other_sites"]) {
    aggregate[key].sort((a, b) => b.visit_count - a.visit_count || String(b.last_visited_at).localeCompare(String(a.last_visited_at)));
    aggregate[key] = aggregate[key].slice(0, config.browser.maxSitesPerCategory * 2);
  }
  return {
    collected_at: new Date().toISOString(),
    lookback_days: config.lookbackDays,
    browsers: results,
    aggregate
  };
}

async function collectChatlogSummary(root, config) {
  const chatlogDir = path.join(root, "chatlog");
  if (!fs.existsSync(chatlogDir)) {
    return { total_files: 0, recent_files: [] };
  }
  const entries = await fsp.readdir(chatlogDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const filePath = path.join(chatlogDir, entry.name);
    const stat = await fsp.stat(filePath);
    const text = await fsp.readFile(filePath, "utf8");
    const headingMatch = text.match(/^#\s+(.+)$/m) ?? text.match(/^##\s+(.+)$/m);
    files.push({
      name: entry.name,
      path: filePath,
      updated_at: stat.mtime.toISOString(),
      title: truncate(headingMatch?.[1] ?? entry.name, 80)
    });
  }
  files.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return {
    total_files: files.length,
    recent_files: files.slice(0, config.export.maxRecentChatlogs)
  };
}

function frontmatterValue(raw) {
  const value = raw.trim();
  if (value === "null") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

async function readMarkdownCard(filePath) {
  const text = await fsp.readFile(filePath, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = {};
  let body = text;
  if (match) {
    body = text.slice(match[0].length);
    for (const line of match[1].split("\n")) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1);
      frontmatter[key] = frontmatterValue(value);
    }
  }
  return { frontmatter, body };
}

async function readJsonl(filePath) {
  const text = await fsp.readFile(filePath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function latestBranchStates(events) {
  const states = new Map();
  for (const event of events) {
    if (!event.branch_id) {
      continue;
    }
    states.set(event.branch_id, {
      branch_id: event.branch_id,
      owner: event.owner ?? null,
      route: event.route ?? null,
      status: event.status ?? null,
      last_event: event.event ?? null,
      updated_at: event.timestamp ?? null
    });
  }
  return [...states.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function ownerStats(tasks) {
  const stats = new Map();
  for (const task of tasks) {
    for (const branch of task.branches) {
      const current = stats.get(branch.owner ?? "unknown") ?? { owner: branch.owner ?? "unknown", branches: 0 };
      current.branches += 1;
      stats.set(current.owner, current);
    }
  }
  return [...stats.values()].sort((a, b) => b.branches - a.branches || a.owner.localeCompare(b.owner));
}

function buildSequenceSteps(events) {
  const steps = [];
  for (const event of events) {
    if (event.event === "branch_assigned") {
      steps.push({ from: "main", to: event.owner ?? "worker", label: `${event.branch_id} assigned` });
    } else if (event.event === "branch_execution_finished") {
      steps.push({ from: event.owner ?? "worker", to: "validator", label: `${event.branch_id} result` });
    } else if (event.event === "branch_validation_finished") {
      steps.push({
        from: "validator",
        to: "main",
        label: `${event.branch_id} ${String(event.status ?? "done").toUpperCase()}`
      });
    }
  }
  return steps;
}

function sequenceDiagram(steps) {
  const participants = [...new Set(steps.flatMap((step) => [step.from, step.to]))];
  const lines = ["sequenceDiagram"];
  for (const participant of participants) {
    lines.push(`    participant ${participant}`);
  }
  for (const step of steps) {
    lines.push(`    ${step.from}->>${step.to}: ${step.label}`);
  }
  return lines.join("\n");
}

async function collectTaskCards(root, config) {
  const activityDir = path.join(root, "shared/runtime/activity");
  const hotDir = path.join(root, "shared/blackboard/hot");
  const archiveDir = path.join(root, "shared/blackboard/archive");
  const activityEntries = fs.existsSync(activityDir)
    ? await fsp.readdir(activityDir, { withFileTypes: true })
    : [];
  const tasks = [];

  for (const entry of activityEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const taskId = entry.name.replace(/\.jsonl$/, "");
    const activityPath = path.join(activityDir, entry.name);
    const events = await readJsonl(activityPath);
    const hotCardPath = path.join(hotDir, `${taskId}.md`);
    const archiveCardPath = path.join(archiveDir, `${taskId}.md`);
    const cardPath = fs.existsSync(hotCardPath) ? hotCardPath : archiveCardPath;
    const card = fs.existsSync(cardPath) ? await readMarkdownCard(cardPath) : { frontmatter: {}, body: "" };
    const updatedAt =
      card.frontmatter.updated_at ??
      events[events.length - 1]?.timestamp ??
      (await fsp.stat(activityPath)).mtime.toISOString();
    tasks.push({
      task_id: taskId,
      title: card.frontmatter.title ?? taskId,
      status: card.frontmatter.status ?? events[events.length - 1]?.status ?? "unknown",
      owner: card.frontmatter.owner ?? "main",
      updated_at: updatedAt,
      current_branch: card.frontmatter.current_branch ?? null,
      card_path: cardPath || null,
      activity_path: activityPath,
      branches: latestBranchStates(events),
      events,
      sequence: buildSequenceSteps(events)
    });
  }

  tasks.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const limitedTasks = tasks.slice(0, config.export.maxRecentTasks);
  return {
    generated_at: new Date().toISOString(),
    task_count: tasks.length,
    active_tasks: limitedTasks.filter((task) => task.status !== "archived"),
    recent_tasks: limitedTasks,
    owner_stats: ownerStats(limitedTasks)
  };
}

async function readCronJobs(root) {
  const cronPath = path.join(root, "cron/jobs.json");
  if (!fs.existsSync(cronPath)) {
    return [];
  }
  const payload = JSON.parse(await fsp.readFile(cronPath, "utf8"));
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

export async function sampleApps(root, deviceId) {
  const stateDir = path.join(root, "shared/runtime/remote_ops/state", deviceId);
  await ensureDir(stateDir);
  const sample = {
    collected_at: new Date().toISOString(),
    device_id: deviceId,
    collector: "osascript",
    frontmost_app: null,
    running_apps: [],
    ok: false,
    error: null
  };
  try {
    const frontmost = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to get name of first application process whose frontmost is true'
    ]);
    const running = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to get name of every application process whose background only is false'
    ]);
    sample.frontmost_app = frontmost.stdout.trim() || null;
    sample.running_apps = running.stdout
      .trim()
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    sample.ok = true;
  } catch (error) {
    sample.error = error.stderr?.trim() || error.message;
  }
  const samplePath = path.join(stateDir, "app-samples.jsonl");
  await fsp.appendFile(samplePath, `${JSON.stringify(sample)}\n`, "utf8");
  return { sample_path: samplePath, sample };
}

async function summarizeApps(root, deviceId, config) {
  const samplePath = path.join(root, "shared/runtime/remote_ops/state", deviceId, "app-samples.jsonl");
  if (!fs.existsSync(samplePath)) {
    return { available: false, sample_count: 0, top_apps: [], last_sample_at: null };
  }
  const samples = await readJsonl(samplePath);
  const threshold = Date.now() - config.lookbackHoursForApps * 60 * 60 * 1000;
  const recent = samples.filter((sample) => Date.parse(sample.collected_at) >= threshold);
  const counts = new Map();
  for (const sample of recent) {
    if (!sample.frontmost_app) {
      continue;
    }
    counts.set(sample.frontmost_app, (counts.get(sample.frontmost_app) ?? 0) + 1);
  }
  const topApps = [...counts.entries()]
    .map(([app, sampleCount]) => ({
      app,
      sample_count: sampleCount,
      approx_minutes: sampleCount * 5
    }))
    .sort((a, b) => b.sample_count - a.sample_count || a.app.localeCompare(b.app))
    .slice(0, 8);
  return {
    available: true,
    sample_count: recent.length,
    last_sample_at: recent[recent.length - 1]?.collected_at ?? null,
    top_apps: topApps
  };
}

export async function buildDeviceSnapshot(root, deviceId, config) {
  const [browser, chatlogs, apps] = await Promise.all([
    collectBrowserUsage(config),
    collectChatlogSummary(root, config),
    summarizeApps(root, deviceId, config)
  ]);

  const snapshot = {
    schema_version: 1,
    collected_at: new Date().toISOString(),
    device_id: deviceId,
    device_label: deviceId,
    hostname: os.hostname(),
    user: os.userInfo().username,
    browser,
    chatlogs,
    apps
  };

  const deviceOutbox = path.join(root, config.paths.outbox, deviceId);
  await ensureDir(deviceOutbox);
  const timestamp = snapshot.collected_at.replace(/[:.]/g, "-");
  const snapshotPath = path.join(deviceOutbox, `${timestamp}.json`);
  const latestPath = path.join(deviceOutbox, "latest.json");
  await fsp.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  await fsp.writeFile(latestPath, JSON.stringify(snapshot, null, 2), "utf8");
  return { snapshot, snapshot_path: snapshotPath, latest_path: latestPath };
}

export async function ingestSnapshot(root, filePath, deviceIdHint = null) {
  const payload = JSON.parse(await fsp.readFile(filePath, "utf8"));
  const deviceId = deviceIdHint ?? payload.device_id ?? "remote-device";
  const inboxDir = path.join(root, "shared/runtime/remote_ops/inbox", deviceId);
  await ensureDir(inboxDir);
  const target = path.join(inboxDir, path.basename(filePath));
  payload.device_id = deviceId;
  payload.device_label = payload.device_label ?? deviceId;
  await fsp.writeFile(target, JSON.stringify(payload, null, 2), "utf8");
  const latest = path.join(inboxDir, "latest.json");
  await fsp.writeFile(latest, JSON.stringify(payload, null, 2), "utf8");
  return { status: "ingested", device_id: deviceId, target_path: target, latest_path: latest };
}

async function loadRemoteSnapshots(root) {
  const inboxRoot = path.join(root, "shared/runtime/remote_ops/inbox");
  if (!fs.existsSync(inboxRoot)) {
    return [];
  }
  const deviceDirs = await fsp.readdir(inboxRoot, { withFileTypes: true });
  const snapshots = [];
  for (const deviceDir of deviceDirs) {
    if (!deviceDir.isDirectory()) {
      continue;
    }
    const latestPath = path.join(inboxRoot, deviceDir.name, "latest.json");
    if (!fs.existsSync(latestPath)) {
      continue;
    }
    const payload = JSON.parse(await fsp.readFile(latestPath, "utf8"));
    snapshots.push(payload);
  }
  snapshots.sort((a, b) => String(b.collected_at).localeCompare(String(a.collected_at)));
  return snapshots;
}

function dashboardAccess(config) {
  const localUrl = config.runtime.dashboardToken
    ? `http://127.0.0.1:${config.runtime.dashboardPort}/#token=${config.runtime.dashboardToken}`
    : `http://127.0.0.1:${config.runtime.dashboardPort}/`;
  const tunnelUrl = config.runtime.dashboardToken
    ? `http://127.0.0.1:${config.ssh.dashboardLocalPort}/#token=${config.runtime.dashboardToken}`
    : `http://127.0.0.1:${config.ssh.dashboardLocalPort}/`;
  return {
    local_url: localUrl,
    tunnel_url: tunnelUrl,
    ssh_tunnel_command: `ssh -N -L ${config.ssh.dashboardLocalPort}:127.0.0.1:${config.ssh.dashboardRemotePort} ${config.ssh.collectorUser}@${config.ssh.collectorHost}`
  };
}

function formatList(items, emptyText = "- none") {
  if (!items.length) {
    return emptyText;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function buildLearningBoardMarkdown(bundle, config) {
  const remoteSnapshot = bundle.remote_snapshots[0] ?? null;
  const localBrowser = bundle.local_snapshot.browser.aggregate;
  const activeTasks = bundle.workflows.active_tasks.slice(0, 5);
  const cronLines = bundle.cron_jobs
    .filter((job) => job.enabled)
    .slice(0, 8)
    .map(
      (job) =>
        `${job.name} | next=${job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : "unknown"}`
    );
  const remoteLines = remoteSnapshot
    ? [
        `remote device: ${remoteSnapshot.device_id} @ ${remoteSnapshot.hostname}`,
        `last snapshot: ${remoteSnapshot.collected_at}`,
        `agent browsing visits: ${remoteSnapshot.browser.aggregate.agent_sites.reduce((sum, item) => sum + item.visit_count, 0)}`,
        `course browsing visits: ${remoteSnapshot.browser.aggregate.course_sites.reduce((sum, item) => sum + item.visit_count, 0)}`
      ]
    : ["No remote MacBook snapshot has been ingested yet."];

  return [
    "# Remote Learning Hub",
    "",
    `Updated: ${bundle.generated_at}`,
    "",
    "## Dashboard Access",
    `- Mac mini dashboard: ${bundle.dashboard.local_url}`,
    `- MacBook SSH tunnel URL: ${bundle.dashboard.tunnel_url}`,
    `- SSH tunnel command: \`${bundle.dashboard.ssh_tunnel_command}\``,
    "",
    "## Local Browser Signals",
    `- Agent conversations/sites: ${localBrowser.agent_sites.length}`,
    `- Course/learning sites: ${localBrowser.course_sites.length}`,
    "",
    "Top agent sites:",
    formatList(
      localBrowser.agent_sites.slice(0, 5).map(
        (site) => `${site.domain} (${site.visit_count}) [${site.browser}]`
      )
    ),
    "",
    "Top course sites:",
    formatList(
      localBrowser.course_sites.slice(0, 5).map(
        (site) => `${site.domain} (${site.visit_count}) [${site.browser}]`
      )
    ),
    "",
    "## Remote MacBook Snapshot",
    formatList(remoteLines),
    "",
    "## Active OpenClaw Tasks",
    formatList(
      activeTasks.map((task) => `${task.title} | status=${task.status} | updated=${task.updated_at}`)
    ),
    "",
    "## Agent Workflow Load",
    formatList(bundle.workflows.owner_stats.map((item) => `${item.owner}: ${item.branches} branches`)),
    "",
    "## Check-ins / Calendar Hooks",
    formatList(cronLines),
    "",
    "## Recent Chatlogs",
    formatList(
      bundle.local_snapshot.chatlogs.recent_files.map(
        (item) => `${item.name} | ${item.updated_at} | ${item.title}`
      )
    ),
    ""
  ].join("\n");
}

function buildWorkflowSummaryMarkdown(bundle) {
  const lines = [
    "# Agent Workflow Summary",
    "",
    `Updated: ${bundle.generated_at}`,
    "",
    "## Owner Load",
    formatList(bundle.workflows.owner_stats.map((item) => `${item.owner}: ${item.branches} branches`)),
    ""
  ];
  for (const task of bundle.workflows.recent_tasks) {
    lines.push(`## ${task.title}`);
    lines.push(`- task_id: ${task.task_id}`);
    lines.push(`- status: ${task.status}`);
    lines.push(`- updated_at: ${task.updated_at}`);
    lines.push("");
    lines.push("Branches:");
    lines.push(
      formatList(
        task.branches.map(
          (branch) =>
            `${branch.branch_id} | owner=${branch.owner} | route=${branch.route} | status=${branch.status}`
        )
      )
    );
    lines.push("");
    if (task.sequence.length) {
      lines.push("```mermaid");
      lines.push(sequenceDiagram(task.sequence));
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildWorkflowHtml(bundle) {
  const payload = {
    generated_at: bundle.generated_at,
    tasks: bundle.workflows.recent_tasks,
    owner_stats: bundle.workflows.owner_stats,
    remote_snapshots: bundle.remote_snapshots.map((item) => ({
      device_id: item.device_id,
      collected_at: item.collected_at,
      hostname: item.hostname,
      browser: item.browser.aggregate,
      apps: item.apps
    })),
    dashboard: bundle.dashboard
  };
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenClaw Remote Ops Dashboard</title>
    <style>
      :root {
        --bg: #f5efe2;
        --card: rgba(255, 252, 245, 0.9);
        --ink: #132a13;
        --muted: #4f6f52;
        --line: rgba(19, 42, 19, 0.12);
        --accent: #b46a55;
        --accent-soft: #e8d7c5;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Avenir Next", "PingFang SC", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(180, 106, 85, 0.18), transparent 38%),
          radial-gradient(circle at bottom right, rgba(79, 111, 82, 0.16), transparent 35%),
          var(--bg);
      }
      main {
        width: min(1200px, calc(100vw - 32px));
        margin: 32px auto 48px;
      }
      .hero {
        background: linear-gradient(135deg, rgba(255,255,255,0.92), rgba(232,215,197,0.92));
        border: 1px solid var(--line);
        border-radius: 28px;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(19, 42, 19, 0.08);
      }
      .hero h1 {
        margin: 0 0 8px;
        font-size: clamp(28px, 5vw, 52px);
        letter-spacing: -0.04em;
      }
      .hero p {
        margin: 0;
        color: var(--muted);
        font-size: 16px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
        margin-top: 18px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 22px;
        padding: 20px;
        box-shadow: 0 8px 24px rgba(19, 42, 19, 0.04);
      }
      h2, h3 {
        margin: 0 0 12px;
        letter-spacing: -0.03em;
      }
      ul {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .tasks {
        margin-top: 24px;
        display: grid;
        gap: 16px;
      }
      .task {
        background: rgba(255, 252, 245, 0.94);
        border: 1px solid var(--line);
        border-radius: 24px;
        overflow: hidden;
      }
      .task-header {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: space-between;
        padding: 18px 20px 12px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(90deg, rgba(180,106,85,0.12), rgba(255,255,255,0.6));
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 6px 10px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
      }
      .branches {
        padding: 16px 20px 20px;
        display: grid;
        gap: 12px;
      }
      .branch {
        border-left: 4px solid var(--accent);
        padding-left: 12px;
      }
      .muted {
        color: var(--muted);
      }
      .code {
        display: block;
        margin-top: 6px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(19, 42, 19, 0.06);
        font-family: "SF Mono", Menlo, monospace;
        font-size: 12px;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <main id="app"></main>
    <script>
      const data = ${JSON.stringify(payload)};
      const app = document.getElementById("app");
      const ownerItems = data.owner_stats.map((item) => "<li>" + item.owner + ": " + item.branches + " branches</li>").join("");
      const remoteItems = data.remote_snapshots.length
        ? data.remote_snapshots.map((item) => {
            const agentVisits = item.browser.agent_sites.reduce((sum, site) => sum + site.visit_count, 0);
            const courseVisits = item.browser.course_sites.reduce((sum, site) => sum + site.visit_count, 0);
            return "<li>" + item.device_id + " @ " + item.hostname + " | " + item.collected_at + " | agent=" + agentVisits + " | course=" + courseVisits + "</li>";
          }).join("")
        : "<li>No remote snapshot ingested yet.</li>";
      const taskCards = data.tasks.map((task) => {
        const branches = task.branches.map((branch) => {
          return '<div class="branch"><strong>' + branch.branch_id + '</strong><div class="muted">' +
            [branch.owner, branch.route, branch.status, branch.updated_at].filter(Boolean).join(" | ") +
            "</div></div>";
        }).join("");
        return '<section class="task"><div class="task-header"><div><h3>' + task.title + '</h3><div class="muted">' +
          task.task_id + '</div></div><div class="pill">' + task.status + '</div></div><div class="branches">' +
          branches + "</div></section>";
      }).join("");
      app.innerHTML = \`
        <section class="hero">
          <h1>OpenClaw Remote Ops</h1>
          <p>Generated at \${data.generated_at}. This page tracks agent workflows, remote snapshots, and MacBook dashboard access for the Mac mini collector.</p>
          <div class="grid">
            <article class="card">
              <h2>Owner Load</h2>
              <ul>\${ownerItems}</ul>
            </article>
            <article class="card">
              <h2>Remote Snapshots</h2>
              <ul>\${remoteItems}</ul>
            </article>
            <article class="card">
              <h2>MacBook Dashboard Access</h2>
              <div class="muted">Tunnel URL</div>
              <div>\${data.dashboard.tunnel_url}</div>
              <span class="code">\${data.dashboard.ssh_tunnel_command}</span>
            </article>
          </div>
        </section>
        <section class="tasks">\${taskCards}</section>
      \`;
    </script>
  </body>
</html>`;
}

function formatIcsDate(date) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatIcsDateOnly(date) {
  return new Date(date).toISOString().slice(0, 10).replace(/-/g, "");
}

function buildCalendarEvents(bundle) {
  const events = [];
  for (const job of bundle.cron_jobs.filter((item) => item.enabled)) {
    if (!job.state?.nextRunAtMs) {
      continue;
    }
    const start = new Date(job.state.nextRunAtMs);
    const end = new Date(job.state.nextRunAtMs + 30 * 60 * 1000);
    events.push({
      uid: `cron-${job.id}@openclaw`,
      start,
      end,
      summary: `OpenClaw ${job.name}`,
      description: job.description ?? job.payload?.text ?? job.name,
      all_day: false
    });
  }
  for (const task of bundle.workflows.active_tasks.slice(0, 5)) {
    const start = new Date(task.updated_at);
    const nextDay = new Date(start);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    events.push({
      uid: `task-${task.task_id}@openclaw`,
      start,
      end: nextDay,
      summary: `Active task: ${task.title}`,
      description: `status=${task.status}; task_id=${task.task_id}`,
      all_day: true
    });
  }
  return events;
}

function buildIcs(bundle) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenClaw//RemoteOps//EN"];
  for (const event of buildCalendarEvents(bundle)) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${formatIcsDate(bundle.generated_at)}`);
    if (event.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(event.start)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(event.end)}`);
    } else {
      lines.push(`DTSTART:${formatIcsDate(event.start)}`);
      lines.push(`DTEND:${formatIcsDate(event.end)}`);
    }
    lines.push(`SUMMARY:${String(event.summary).replace(/\n/g, " ")}`);
    lines.push(`DESCRIPTION:${String(event.description).replace(/\n/g, " ")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\n")}\n`;
}

function buildDashboardAccessMarkdown(bundle) {
  return [
    "# Dashboard Access",
    "",
    `Generated: ${bundle.generated_at}`,
    "",
    `- Local Mac mini dashboard: ${bundle.dashboard.local_url}`,
    `- MacBook tunnel URL: ${bundle.dashboard.tunnel_url}`,
    "",
    "## Tunnel Command",
    `\`${bundle.dashboard.ssh_tunnel_command}\``,
    "",
    "## Notes",
    "- Keep the gateway token private.",
    "- This SSH tunnel keeps the gateway loopback-only on the Mac mini.",
    "- If you later move to Tailscale, update shared/runtime/remote_ops/config.json instead of exposing the gateway directly.",
    ""
  ].join("\n");
}

export async function aggregateRemoteOps(root, deviceId, config) {
  const [localSnapshotResult, remoteSnapshots, workflows, cronJobs] = await Promise.all([
    buildDeviceSnapshot(root, deviceId, config),
    loadRemoteSnapshots(root),
    collectTaskCards(root, config),
    readCronJobs(root)
  ]);
  const bundle = {
    generated_at: new Date().toISOString(),
    device_id: deviceId,
    local_snapshot: localSnapshotResult.snapshot,
    remote_snapshots: remoteSnapshots,
    workflows,
    cron_jobs: cronJobs,
    dashboard: dashboardAccess(config)
  };

  const exportDir = path.join(root, config.paths.exports);
  await ensureDir(exportDir);
  const dataPath = path.join(exportDir, "workflow-summary.json");
  const workflowMdPath = path.join(exportDir, "workflow-summary.md");
  const workflowHtmlPath = path.join(exportDir, "workflow-dashboard.html");
  const learningBoardPath = path.join(exportDir, "learning-board.md");
  const dashboardPath = path.join(exportDir, "dashboard-access.md");
  const calendarPath = path.join(exportDir, "learning-calendar.ics");

  await Promise.all([
    fsp.writeFile(dataPath, JSON.stringify(bundle, null, 2), "utf8"),
    fsp.writeFile(workflowMdPath, buildWorkflowSummaryMarkdown(bundle), "utf8"),
    fsp.writeFile(workflowHtmlPath, buildWorkflowHtml(bundle), "utf8"),
    fsp.writeFile(learningBoardPath, buildLearningBoardMarkdown(bundle, config), "utf8"),
    fsp.writeFile(dashboardPath, buildDashboardAccessMarkdown(bundle), "utf8"),
    fsp.writeFile(calendarPath, buildIcs(bundle), "utf8")
  ]);

  return {
    bundle,
    exports: {
      data_path: dataPath,
      workflow_markdown_path: workflowMdPath,
      workflow_html_path: workflowHtmlPath,
      learning_board_path: learningBoardPath,
      dashboard_access_path: dashboardPath,
      calendar_path: calendarPath
    }
  };
}

export function composeNotification(bundle, config) {
  const activeCount = bundle.workflows.active_tasks.length;
  const remoteSnapshot = bundle.remote_snapshots[0] ?? null;
  const alerts = [];
  if (!remoteSnapshot) {
    alerts.push("MacBook snapshot missing");
  } else {
    const ageHours = (Date.now() - Date.parse(remoteSnapshot.collected_at)) / (1000 * 60 * 60);
    if (ageHours > config.notifications.staleSnapshotHours) {
      alerts.push(`MacBook snapshot stale (${ageHours.toFixed(1)}h)`);
    }
  }
  const blockedTasks = bundle.workflows.recent_tasks.filter((task) => task.status === "blocked");
  if (blockedTasks.length) {
    alerts.push(`${blockedTasks.length} blocked task(s)`);
  }
  const lines = [
    "OpenClaw remote hub update",
    `- generated: ${bundle.generated_at}`,
    `- active tasks: ${activeCount}`,
    `- owner load: ${bundle.workflows.owner_stats.map((item) => `${item.owner}=${item.branches}`).join(", ") || "none"}`,
    remoteSnapshot
      ? `- latest MacBook snapshot: ${remoteSnapshot.collected_at} (${remoteSnapshot.hostname})`
      : "- latest MacBook snapshot: missing",
    remoteSnapshot
      ? `- MacBook agent/course visits: ${remoteSnapshot.browser.aggregate.agent_sites.reduce((sum, item) => sum + item.visit_count, 0)}/${remoteSnapshot.browser.aggregate.course_sites.reduce((sum, item) => sum + item.visit_count, 0)}`
      : "- MacBook agent/course visits: n/a"
  ];
  if (alerts.length) {
    lines.push(`- alerts: ${alerts.join("; ")}`);
  }
  return {
    alerts,
    text: lines.join("\n"),
    should_send: !config.notifications.onlyIfAlert || alerts.length > 0
  };
}

export async function sendNotification(root, bundle, config, options = {}) {
  const heartbeat = config.runtime.heartbeat ?? {};
  const channel = options.channel ?? heartbeat.target ?? config.notifications.defaultChannel;
  const target = options.target ?? heartbeat.to ?? null;
  if (!target) {
    throw new Error("No notification target configured. Set agents.defaults.heartbeat.to or pass --target.");
  }
  const message = composeNotification(bundle, config);
  if (!message.should_send) {
    return {
      status: "skipped",
      reason: "only_if_alert",
      text: message.text
    };
  }
  const args = [
    "message",
    "send",
    "--channel",
    channel,
    "--target",
    target,
    "--message",
    message.text,
    "--json"
  ];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  const { stdout } = await execFileAsync("openclaw", args, {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    status: options.dryRun ? "dry_run" : "sent",
    channel,
    target,
    text: message.text,
    response: stdout.trim() ? parseJsonFromMixedOutput(stdout) : null
  };
}

export async function syncExportsToObsidian(root, config) {
  const obsidian = config.runtime.obsidianConfig;
  if (!obsidian?.vaultRoot) {
    throw new Error("obsidian-bridge is not configured.");
  }
  const draftRoot = path.join(obsidian.vaultRoot, obsidian.draftRoot ?? "Drafts/AI");
  const exportDir = path.join(root, config.paths.exports);
  const targetDir = path.join(draftRoot, config.export.obsidianDraftSubdir);
  await ensureDir(targetDir);
  const files = [
    "workflow-summary.md",
    "workflow-dashboard.html",
    "learning-board.md",
    "dashboard-access.md",
    "learning-calendar.ics"
  ];
  const copied = [];
  for (const fileName of files) {
    const source = path.join(exportDir, fileName);
    if (!fs.existsSync(source)) {
      continue;
    }
    const target = path.join(targetDir, fileName);
    await fsp.copyFile(source, target);
    copied.push(target);
  }
  return {
    status: "synced",
    target_dir: targetDir,
    files: copied
  };
}
