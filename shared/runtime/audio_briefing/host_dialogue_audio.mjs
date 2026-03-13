#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
const OPENCLAW_CONFIG_PATH = path.join(ROOT, "openclaw.json");
const RUNTIME_ROOT = path.join(ROOT, "shared", "runtime", "audio_briefing");
const TMP_ROOT = path.join(RUNTIME_ROOT, "tmp");
const OUTBOX_ROOT = path.join(ROOT, "media", "audio_briefing");

const DEFAULT_VOICE_A = "Eddy (中文（中国大陆）)";
const DEFAULT_VOICE_B = "Flo (中文（中国大陆）)";
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_SILENCE_MS = 180;

function parseArgs(argv) {
  const args = {
    command: "render",
    text: "",
    scriptFile: "",
    out: "",
    title: "",
    voiceA: DEFAULT_VOICE_A,
    voiceB: DEFAULT_VOICE_B,
    channel: "",
    target: "",
    dryRun: false,
    sampleRate: DEFAULT_SAMPLE_RATE,
    silenceMs: DEFAULT_SILENCE_MS,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const value = argv[i + 1];
    switch (token) {
      case "--text":
        args.text = value ?? "";
        i += 1;
        break;
      case "--script-file":
        args.scriptFile = value ?? "";
        i += 1;
        break;
      case "--out":
        args.out = value ?? "";
        i += 1;
        break;
      case "--title":
        args.title = value ?? "";
        i += 1;
        break;
      case "--voice-a":
        args.voiceA = value ?? DEFAULT_VOICE_A;
        i += 1;
        break;
      case "--voice-b":
        args.voiceB = value ?? DEFAULT_VOICE_B;
        i += 1;
        break;
      case "--channel":
        args.channel = value ?? "";
        i += 1;
        break;
      case "--target":
        args.target = value ?? "";
        i += 1;
        break;
      case "--sample-rate":
        args.sampleRate = Number(value ?? DEFAULT_SAMPLE_RATE);
        i += 1;
        break;
      case "--silence-ms":
        args.silenceMs = Number(value ?? DEFAULT_SILENCE_MS);
        i += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (positional.length > 0) {
    args.command = positional[0];
  }
  return args;
}

function usage() {
  return `Usage:
  node shared/runtime/audio_briefing/host_dialogue_audio.mjs render --script-file file.txt [--title title]
  node shared/runtime/audio_briefing/host_dialogue_audio.mjs render-and-send --script-file file.txt [--title title]
  node shared/runtime/audio_briefing/host_dialogue_audio.mjs send --out file.wav [--channel feishu --target <open_id>]

Commands:
  render            Build a dual-host WAV file from a transcript
  send              Send an existing audio file through OpenClaw message send
  render-and-send   Render first, then send

Transcript format:
  甲：开场内容
  乙：回应内容
  甲：下一句
`;
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`));
    });
  });
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "morning-anchor-briefing";
}

async function ensureDirs() {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  await fs.mkdir(OUTBOX_ROOT, { recursive: true });
}

async function loadTranscript(args) {
  if (args.text) {
    return args.text;
  }
  if (args.scriptFile) {
    return await fs.readFile(path.resolve(args.scriptFile), "utf8");
  }
  throw new Error("Missing transcript. Provide --text or --script-file.");
}

function parseDialogue(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const segments = [];
  for (const line of lines) {
    const speakerMatch = line.match(/^([甲乙])\s*[：:]\s*(.+)$/u);
    if (speakerMatch) {
      segments.push({
        speaker: speakerMatch[1],
        text: speakerMatch[2].trim(),
      });
      continue;
    }
    segments.push({
      speaker: "甲",
      text: line,
    });
  }

  if (segments.length === 0) {
    throw new Error("Transcript is empty after parsing.");
  }
  return segments;
}

function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected PCM WAV data.");
  }

  let offset = 12;
  let fmt;
  let data;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;

    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkDataStart),
        channels: buffer.readUInt16LE(chunkDataStart + 2),
        sampleRate: buffer.readUInt32LE(chunkDataStart + 4),
        byteRate: buffer.readUInt32LE(chunkDataStart + 8),
        blockAlign: buffer.readUInt16LE(chunkDataStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkDataStart + 14),
      };
    } else if (chunkId === "data") {
      data = buffer.subarray(chunkDataStart, chunkDataEnd);
    }

    offset = chunkDataEnd + (chunkSize % 2);
  }

  if (!fmt || !data) {
    throw new Error("Malformed WAV file.");
  }
  if (fmt.audioFormat !== 1) {
    throw new Error("Only PCM WAV is supported for concatenation.");
  }
  return { fmt, data };
}

function buildWav({ fmt, chunks }) {
  const dataSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, 4, "ascii");
  header.write("fmt ", 12, 4, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(fmt.channels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(fmt.byteRate, 28);
  header.writeUInt16LE(fmt.blockAlign, 32);
  header.writeUInt16LE(fmt.bitsPerSample, 34);
  header.write("data", 36, 4, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, ...chunks], 44 + dataSize);
}

function buildSilence(fmt, silenceMs) {
  const bytesPerFrame = fmt.blockAlign;
  const frameCount = Math.max(1, Math.round((fmt.sampleRate * silenceMs) / 1000));
  return Buffer.alloc(frameCount * bytesPerFrame, 0);
}

async function renderDialogue(args) {
  await ensureDirs();
  const transcript = await loadTranscript(args);
  const segments = parseDialogue(transcript);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const title = args.title || `morning-anchor-${stamp}`;
  const slug = slugify(title);
  const outPath = path.resolve(args.out || path.join(OUTBOX_ROOT, `${stamp}-${slug}.wav`));
  const workDir = path.join(TMP_ROOT, `${stamp}-${slug}`);
  await fs.mkdir(workDir, { recursive: true });

  const rendered = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const voice = segment.speaker === "乙" ? args.voiceB : args.voiceA;
    const aiffPath = path.join(workDir, `${String(index).padStart(2, "0")}-${segment.speaker}.aiff`);
    const wavPath = path.join(workDir, `${String(index).padStart(2, "0")}-${segment.speaker}.wav`);
    await runCommand("say", ["-v", voice, "-o", aiffPath, segment.text]);
    await runCommand("afconvert", [aiffPath, "-f", "WAVE", "-d", `LEI16@${args.sampleRate}`, "-o", wavPath]);
    rendered.push({ ...segment, voice, wavPath });
  }

  const wavChunks = [];
  let baseFmt = null;
  for (const renderedSegment of rendered) {
    const wavBuffer = await fs.readFile(renderedSegment.wavPath);
    const parsed = parseWav(wavBuffer);
    if (!baseFmt) {
      baseFmt = parsed.fmt;
    } else if (
      parsed.fmt.channels !== baseFmt.channels ||
      parsed.fmt.sampleRate !== baseFmt.sampleRate ||
      parsed.fmt.bitsPerSample !== baseFmt.bitsPerSample
    ) {
      throw new Error("Rendered WAV segments do not share the same PCM format.");
    }
    wavChunks.push(parsed.data);
    wavChunks.push(buildSilence(baseFmt, args.silenceMs));
  }

  if (!baseFmt) {
    throw new Error("No audio segments were rendered.");
  }

  const combined = buildWav({ fmt: baseFmt, chunks: wavChunks });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, combined);

  const transcriptPath = outPath.replace(/\.wav$/i, ".txt");
  await fs.writeFile(transcriptPath, transcript, "utf8");

  return {
    outPath,
    transcriptPath,
    title,
    segments: rendered.map(({ speaker, voice, text }) => ({ speaker, voice, text })),
  };
}

async function loadConfig() {
  const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

async function resolveSendTarget(args) {
  if (args.channel && args.target) {
    return { channel: args.channel, target: args.target };
  }
  const config = await loadConfig();
  const heartbeat = config?.agents?.defaults?.heartbeat;
  if (!heartbeat?.target || !heartbeat?.to) {
    throw new Error("Missing heartbeat target in openclaw.json. Provide --channel and --target.");
  }
  return {
    channel: args.channel || heartbeat.target,
    target: args.target || heartbeat.to,
  };
}

async function sendAudio(args) {
  if (!args.out) {
    throw new Error("Missing --out for send command.");
  }
  const mediaPath = path.resolve(args.out);
  const { channel, target } = await resolveSendTarget(args);
  const sendArgs = [
    "message",
    "send",
    "--channel",
    channel,
    "--target",
    target,
    "--media",
    mediaPath,
    "--json",
  ];
  if (args.dryRun) {
    sendArgs.push("--dry-run");
  }
  return await new Promise((resolve, reject) => {
    const child = spawn("openclaw", sendArgs, {
      stdio: ["ignore", "pipe", "pipe"],
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
      if (code === 0) {
        try {
          const payload = extractTrailingJson(stdout);
          resolve({
            channel,
            target,
            payload,
            stderr: stderr.trim(),
          });
        } catch (error) {
          reject(error);
        }
        return;
      }
      reject(new Error(`openclaw message send failed: ${stderr.trim()}`));
    });
  });
}

function extractTrailingJson(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = lines.slice(index).join("\n").trim();
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning for the last valid JSON block
    }
  }

  throw new Error("Unable to extract JSON payload from openclaw message send output.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!["render", "send", "render-and-send"].includes(args.command)) {
    console.error(usage());
    process.exit(1);
  }

  if (args.command === "render") {
    const rendered = await renderDialogue(args);
    console.log(JSON.stringify({ ok: true, command: args.command, ...rendered }, null, 2));
    return;
  }

  if (args.command === "send") {
    const result = await sendAudio(args);
    console.log(JSON.stringify({ ok: true, command: args.command, outPath: path.resolve(args.out), ...result }, null, 2));
    return;
  }

  const rendered = await renderDialogue(args);
  const sendResult = await sendAudio({
    ...args,
    out: rendered.outPath,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        command: args.command,
        ...rendered,
        sendResult,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
