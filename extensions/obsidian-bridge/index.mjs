import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function getConfig(api) {
  const cfg = api.runtime.config.loadConfig();
  return cfg?.plugins?.entries?.["obsidian-bridge"]?.config ?? {};
}

function buildToolText(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function ensureVaultConfigured(config) {
  if (!config.vaultRoot) {
    throw new Error("obsidian-bridge is not configured: missing vaultRoot");
  }
}

function resolveInside(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relativePath);
  if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error("path escapes configured vault root");
  }
  return resolved;
}

export default function register(api) {
  api.registerTool(
    {
      name: "obsidian_bridge_status",
      description: "Report whether the Obsidian bridge is configured and where drafts will be written.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute() {
        const config = getConfig(api);
        return buildToolText({
          configured: Boolean(config.vaultRoot),
          vault_root: config.vaultRoot ?? null,
          draft_root: config.draftRoot ?? "Drafts/AI",
          patch_root: config.patchRoot ?? "Drafts/AI/_patches",
          allow_official_writes: Boolean(config.allowOfficialWrites)
        });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "obsidian_bridge_read",
      description: "Read a file from the configured Obsidian vault.",
      parameters: {
        type: "object",
        properties: {
          relative_path: { type: "string" }
        },
        required: ["relative_path"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const config = getConfig(api);
        ensureVaultConfigured(config);
        const target = resolveInside(config.vaultRoot, params.relative_path);
        const text = await fsp.readFile(target, "utf8");
        return buildToolText({ relative_path: params.relative_path, text });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "obsidian_bridge_write_draft",
      description: "Write a draft file inside the configured Obsidian draft area.",
      parameters: {
        type: "object",
        properties: {
          relative_path: { type: "string" },
          text: { type: "string" },
          overwrite: { type: "boolean", default: false }
        },
        required: ["relative_path", "text"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const config = getConfig(api);
        ensureVaultConfigured(config);
        const draftRoot = resolveInside(config.vaultRoot, config.draftRoot ?? "Drafts/AI");
        const target = resolveInside(draftRoot, params.relative_path);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        if (!params.overwrite && fs.existsSync(target)) {
          return buildToolText({ status: "exists", relative_path: params.relative_path });
        }
        await fsp.writeFile(target, params.text, "utf8");
        return buildToolText({ status: "written", relative_path: params.relative_path, path: target });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "obsidian_bridge_prepare_patch",
      description: "Write a patch note into the draft patch area instead of touching the official vault directly.",
      parameters: {
        type: "object",
        properties: {
          target_path: { type: "string" },
          summary: { type: "string" },
          patch_body: { type: "string" }
        },
        required: ["target_path", "summary", "patch_body"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const config = getConfig(api);
        ensureVaultConfigured(config);
        const patchRoot = resolveInside(
          config.vaultRoot,
          config.patchRoot ?? "Drafts/AI/_patches"
        );
        await fsp.mkdir(patchRoot, { recursive: true });
        const fileName = `${Date.now()}-${path.basename(params.target_path).replace(/\.[^.]+$/, "")}.md`;
        const target = path.join(patchRoot, fileName);
        const content = [
          `# Patch Draft`,
          ``,
          `- target: ${params.target_path}`,
          `- summary: ${params.summary}`,
          ``,
          `## Proposed Patch`,
          params.patch_body
        ].join("\n");
        await fsp.writeFile(target, `${content}\n`, "utf8");
        return buildToolText({ status: "prepared", path: target });
      }
    },
    { optional: true }
  );

  api.registerCli(
    ({ program }) => {
      program
        .command("obsidian-bridge")
        .description("Inspect Obsidian bridge configuration.")
        .command("status")
        .action(() => {
          console.log(JSON.stringify(getConfig(api), null, 2));
        });
    },
    { commands: ["obsidian-bridge"] }
  );
}
