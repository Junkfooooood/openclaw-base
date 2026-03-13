import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function extractTextFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => extractTextFromContent(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof content === "object") {
    if (content.type === "text" && typeof content.text === "string") {
      return content.text;
    }
    return Object.values(content)
      .map((value) => extractTextFromContent(value))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export function isPlaceholderReply(text) {
  const normalized = String(text ?? "").trim().toUpperCase();
  return normalized === "" || normalized === "READY";
}

async function sessionLogCandidates(root, agentId) {
  const sessionsDir = path.join(root, "agents", agentId, "sessions");
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const entries = await fsp.readdir(sessionsDir);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const filePath = path.join(sessionsDir, entry);
    const stat = await fsp.stat(filePath);
    candidates.push({ filePath, mtimeMs: stat.mtimeMs });
  }

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function parseAssistantEntries(raw, startedAt) {
  const lines = String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const results = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type !== "message" || parsed.message?.role !== "assistant") {
      continue;
    }

    const timestampMs = Date.parse(parsed.timestamp ?? "");
    if (Number.isFinite(timestampMs) && timestampMs + 500 < startedAt) {
      continue;
    }

    const text = extractTextFromContent(parsed.message?.content).trim();
    if (!text) continue;

    results.push({
      timestamp: parsed.timestamp ?? null,
      text,
      stopReason: parsed.message?.stopReason ?? null
    });
  }

  return results;
}

export async function waitForAgentFinalReply(root, agentId, startedAt, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 120000);
  const pollMs = Number(options.pollMs ?? 1000);
  const accept =
    options.accept ??
    ((candidate) => candidate.stopReason === "stop" && !isPlaceholderReply(candidate.text));
  const deadline = Date.now() + timeoutMs;
  let lastCandidate = null;

  while (Date.now() <= deadline) {
    const candidates = await sessionLogCandidates(root, agentId);
    for (const candidate of candidates.slice(0, 3)) {
      const raw = await fsp.readFile(candidate.filePath, "utf8");
      const assistantEntries = parseAssistantEntries(raw, startedAt);
      for (let i = assistantEntries.length - 1; i >= 0; i -= 1) {
        const entry = assistantEntries[i];
        lastCandidate = {
          ...entry,
          file_path: candidate.filePath
        };
        if (accept(lastCandidate)) {
          return lastCandidate;
        }
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }

  return lastCandidate;
}
