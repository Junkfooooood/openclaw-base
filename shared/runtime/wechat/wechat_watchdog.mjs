#!/usr/bin/env node
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOME = homedir();
const OPENCLAW_DIR = path.join(HOME, ".openclaw");
const CONFIG_FILE = path.join(OPENCLAW_DIR, "openclaw.json");
const STATE_DIR = path.join(__dirname, "state");
const STATUS_FILE = path.join(STATE_DIR, "watchdog-status.json");
const EVENTS_FILE = path.join(STATE_DIR, "watchdog-events.log");
const RECOVERY_QR_FILE = path.join(STATE_DIR, "latest-recovery-qr.txt");
const LOCK_FILE = path.join(STATE_DIR, "watchdog.lock");
const START_STACK_SCRIPT = path.join(__dirname, "start_wechat_stack.sh");
const QR_SCRIPT = path.join(__dirname, "latest_wechat_qr.sh");
const BASH_BIN = "/bin/bash";
const PATH_ENTRIES = [
  path.join(HOME, ".local", "bin"),
  path.join(HOME, ".npm-global", "bin"),
  path.join(HOME, "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
];
process.env.PATH = [...PATH_ENTRIES, process.env.PATH ?? ""].filter(Boolean).join(":");

function resolveBinary(name, fallbacks = []) {
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const lookup = spawnSync("which", [name], { encoding: "utf8" });
  if (lookup.status === 0 && lookup.stdout.trim()) {
    return lookup.stdout.trim();
  }

  throw new Error(`unable to resolve binary: ${name}`);
}

const OPENCLAW_BIN = resolveBinary("openclaw", [
  path.join(HOME, ".local", "bin", "openclaw"),
  "/opt/homebrew/bin/openclaw",
  "/usr/local/bin/openclaw",
]);
const GATEWAY_RESTART = [OPENCLAW_BIN, "gateway", "restart"];

mkdirSync(STATE_DIR, { recursive: true });

const args = new Set(process.argv.slice(2));
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "status";
const quiet = args.has("--quiet");
const force = args.has("--force");
const maxRetries = 3;
const retryDelayMs = 3000;
const lockStaleMs = 15 * 60 * 1000;

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}`;
  appendFileSync(EVENTS_FILE, `${line}\n`, "utf8");
  if (!quiet) {
    process.stdout.write(`${line}\n`);
  }
}

function runCommand(commandName, commandArgs, options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    cwd: options.cwd ?? OPENCLAW_DIR,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readWechatConfig() {
  const raw = readFileSync(CONFIG_FILE, "utf8");
  const parsed = JSON.parse(raw);
  const wechat = parsed?.channels?.wechat ?? {};
  return {
    enabled: wechat.enabled === true,
    serverUrl: wechat.serverUrl ?? "",
    token: wechat.token ?? "",
  };
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 5000);

  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getLoginStatus(serverUrl, token) {
  const endpoint = `${serverUrl.replace(/\/$/, "")}/login/GetLoginStatus?key=${encodeURIComponent(token)}`;
  try {
    const result = await fetchJson(endpoint, { timeoutMs: 5000 });
    return {
      reachable: result.ok,
      statusCode: result.status,
      code: result.json?.Code ?? null,
      loginState: result.json?.Data?.loginState ?? null,
      loginErrMsg: result.json?.Data?.loginErrMsg ?? "",
      onlineTime: result.json?.Data?.onlineTime ?? "",
      raw: result.json,
    };
  } catch (error) {
    return {
      reachable: false,
      statusCode: null,
      code: null,
      loginState: null,
      loginErrMsg: String(error),
      onlineTime: "",
      raw: null,
    };
  }
}

function readRecoveryQr() {
  if (!existsSync(RECOVERY_QR_FILE)) {
    return "";
  }
  return readFileSync(RECOVERY_QR_FILE, "utf8").trim();
}

function writeRecoveryQr(url) {
  writeFileSync(RECOVERY_QR_FILE, `${url.trim()}\n`, "utf8");
}

function getQrUrl() {
  const result = runCommand(BASH_BIN, [QR_SCRIPT]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "failed to get QR url");
  }
  const qr = result.stdout.trim();
  if (qr) {
    writeRecoveryQr(qr);
  }
  return qr;
}

async function collectStatus() {
  const config = readWechatConfig();
  const login = config.serverUrl && config.token
    ? await getLoginStatus(config.serverUrl, config.token)
    : {
        reachable: false,
        statusCode: null,
        code: null,
        loginState: null,
        loginErrMsg: "wechat config incomplete",
        onlineTime: "",
        raw: null,
      };

  const healthy = config.enabled && login.reachable && login.code === 200 && login.loginState === 1;

  const status = {
    checkedAt: new Date().toISOString(),
    healthy,
    config: {
      enabled: config.enabled,
      serverUrl: config.serverUrl,
    },
    login,
    recoveryQrUrl: readRecoveryQr(),
  };

  writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return status;
}

function restartGateway() {
  const result = runCommand(GATEWAY_RESTART[0], GATEWAY_RESTART.slice(1));
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "gateway restart failed");
  }
  logLine("wechat-watchdog restarted gateway");
}

function restartWechatStack() {
  const result = runCommand(BASH_BIN, [START_STACK_SCRIPT]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "wechat stack restart failed");
  }
  logLine("wechat-watchdog restarted wechat stack");
}

async function healWechat() {
  const before = await collectStatus();
  if (before.healthy && !force) {
    logLine("wechat-watchdog found channel healthy; no action taken");
    return before;
  }

  if (before.login.code === 300 && !force) {
    try {
      const qr = getQrUrl();
      before.recoveryQrUrl = qr;
      writeFileSync(STATUS_FILE, `${JSON.stringify(before, null, 2)}\n`, "utf8");
      logLine("wechat-watchdog detected manual login required; refreshed recovery QR only");
      return before;
    } catch {
      restartGateway();
      sleep(3000);
      const refreshed = await collectStatus();
      try {
        const qr = getQrUrl();
        refreshed.recoveryQrUrl = qr;
        writeFileSync(STATUS_FILE, `${JSON.stringify(refreshed, null, 2)}\n`, "utf8");
        logLine("wechat-watchdog refreshed gateway and produced recovery QR");
      } catch (error) {
        logLine(`wechat-watchdog could not refresh QR after gateway restart: ${String(error)}`);
      }
      return refreshed;
    }
  }

  logLine(
    `wechat-watchdog healing channel (reachable=${before.login.reachable} loginState=${before.login.loginState})`,
  );

  restartGateway();
  sleep(2000);

  let afterGateway = await collectStatus();
  if (afterGateway.healthy && !force) {
    logLine("wechat-watchdog recovered after gateway restart");
    return afterGateway;
  }

  restartWechatStack();
  sleep(4000);
  restartGateway();

  let finalStatus = afterGateway;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    sleep(retryDelayMs);
    finalStatus = await collectStatus();
    if (finalStatus.healthy) {
      logLine(`wechat-watchdog recovered after stack restart (attempt=${attempt})`);
      return finalStatus;
    }
  }

  try {
    const qr = getQrUrl();
    finalStatus.recoveryQrUrl = qr;
    writeFileSync(STATUS_FILE, `${JSON.stringify(finalStatus, null, 2)}\n`, "utf8");
    logLine("wechat-watchdog requires manual QR scan");
  } catch (error) {
    logLine(`wechat-watchdog failed to fetch recovery QR: ${String(error)}`);
  }

  return finalStatus;
}

async function main() {
  let lockFd = null;
  let lockHeld = false;
  try {
    if (existsSync(LOCK_FILE)) {
      const ageMs = Date.now() - statSync(LOCK_FILE).mtimeMs;
      if (ageMs > lockStaleMs) {
        unlinkSync(LOCK_FILE);
      }
    }

    lockFd = openSync(LOCK_FILE, "wx");
    lockHeld = true;

    if (command === "status") {
      const status = await collectStatus();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (command === "heal") {
      const status = await healWechat();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    process.stderr.write(`Unsupported command: ${command}\n`);
    process.exitCode = 1;
  } catch (error) {
    if (String(error).includes("EEXIST")) {
      logLine("wechat-watchdog skipped because another run is active");
      return;
    }
    throw error;
  } finally {
    if (lockFd !== null) {
      closeSync(lockFd);
    }
    if (lockHeld && existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
    }
  }
}

main().catch((error) => {
  logLine(`wechat-watchdog crashed: ${String(error)}`);
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
