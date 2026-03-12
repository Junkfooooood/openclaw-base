import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROUTES = {
  logs: {
    label: "日志板块",
    draftSubdir: "Logs",
    officialRoot: "日志板块"
  },
  knowledge: {
    label: "知识库",
    draftSubdir: "Knowledge",
    officialRoot: "_知识库"
  },
  taskboard: {
    label: "任务看板",
    draftSubdir: "TaskBoard",
    officialRoot: "任务榜单记录"
  },
  capabilities: {
    label: "六维能力",
    draftSubdir: "Capabilities",
    officialRoot: "六维能力记录"
  },
  reputation: {
    label: "声望",
    draftSubdir: "Reputation",
    officialRoot: "声望榜单"
  },
  strategy: {
    label: "战略板块",
    draftSubdir: "Strategy",
    officialRoot: "_战略板块"
  }
};

const ROUTE_ALIASES = new Map([
  ["log", "logs"],
  ["logs", "logs"],
  ["journal", "logs"],
  ["日志", "logs"],
  ["日志板块", "logs"],
  ["knowledge", "knowledge"],
  ["kb", "knowledge"],
  ["知识", "knowledge"],
  ["知识库", "knowledge"],
  ["task", "taskboard"],
  ["tasks", "taskboard"],
  ["taskboard", "taskboard"],
  ["任务", "taskboard"],
  ["任务板块", "taskboard"],
  ["任务看板", "taskboard"],
  ["capability", "capabilities"],
  ["capabilities", "capabilities"],
  ["能力", "capabilities"],
  ["六维能力", "capabilities"],
  ["六维能力记录", "capabilities"],
  ["reputation", "reputation"],
  ["声望", "reputation"],
  ["声望榜单", "reputation"],
  ["strategy", "strategy"],
  ["战略", "strategy"],
  ["战略板块", "strategy"]
]);

function getConfig(api) {
  const cfg = api.runtime.config.loadConfig();
  return cfg?.plugins?.entries?.["obsidian-bridge"]?.config ?? {};
}

function getDraftRoot(config) {
  return resolveInside(config.vaultRoot, config.draftRoot ?? "Drafts/AI");
}

function getPatchRoot(config) {
  return resolveInside(config.vaultRoot, config.patchRoot ?? "Drafts/AI/_patches");
}

function getRoutes(config) {
  const merged = {};
  const configuredRoutes = config.routes ?? {};
  for (const [key, defaults] of Object.entries(DEFAULT_ROUTES)) {
    merged[key] = {
      key,
      ...defaults,
      ...(configuredRoutes[key] ?? {})
    };
  }
  for (const [key, value] of Object.entries(configuredRoutes)) {
    if (!merged[key]) {
      merged[key] = {
        key,
        label: value.label ?? key,
        draftSubdir: value.draftSubdir ?? key,
        officialRoot: value.officialRoot ?? key
      };
    }
  }
  return merged;
}

function resolveRoute(config, routeKey) {
  const normalized = String(routeKey).trim().toLowerCase();
  const canonical = ROUTE_ALIASES.get(normalized) ?? normalized;
  const routes = getRoutes(config);
  const route = routes[canonical];
  if (!route) {
    throw new Error(
      `unknown route '${routeKey}', expected one of: ${Object.keys(routes).sort().join(", ")}`
    );
  }
  return route;
}

function buildRoutesPayload(config) {
  const routes = getRoutes(config);
  return Object.fromEntries(
    Object.entries(routes).map(([key, route]) => [
      key,
      {
        label: route.label,
        draft_subdir: route.draftSubdir,
        official_root: route.officialRoot
      }
    ])
  );
}

function buildToolText(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function normalizeMultilineText(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
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

async function writeDraftFile(config, relativePath, text, overwrite) {
  const draftRoot = getDraftRoot(config);
  const target = resolveInside(draftRoot, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (!overwrite && fs.existsSync(target)) {
    return { status: "exists", relative_path: relativePath, path: target };
  }
  await fsp.writeFile(target, normalizeMultilineText(text), "utf8");
  return { status: "written", relative_path: relativePath, path: target };
}

async function preparePatchFile(config, relativePath, targetPath, summary, patchBody) {
  const patchRoot = getPatchRoot(config);
  const target = resolveInside(patchRoot, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const content = [
    "# Patch Draft",
    "",
    `- target: ${targetPath}`,
    `- summary: ${summary}`,
    "",
    "## Proposed Patch",
    normalizeMultilineText(patchBody)
  ].join("\n");
  await fsp.writeFile(target, `${content}\n`, "utf8");
  return { status: "prepared", path: target, target_path: targetPath };
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
          allow_official_writes: Boolean(config.allowOfficialWrites),
          routes: buildRoutesPayload(config)
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
        return buildToolText(
          await writeDraftFile(config, params.relative_path, params.text, params.overwrite)
        );
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "obsidian_bridge_routes",
      description: "List the configured business routes for the Obsidian vault.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute() {
        const config = getConfig(api);
        ensureVaultConfigured(config);
        return buildToolText({ routes: buildRoutesPayload(config) });
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "obsidian_bridge_write_routed_draft",
      description:
        "Write a draft into a route-specific draft subdirectory such as logs, knowledge, taskboard, capabilities, reputation, or strategy.",
      parameters: {
        type: "object",
        properties: {
          route: { type: "string" },
          relative_path: { type: "string" },
          text: { type: "string" },
          overwrite: { type: "boolean", default: false }
        },
        required: ["route", "relative_path", "text"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const config = getConfig(api);
        ensureVaultConfigured(config);
        const route = resolveRoute(config, params.route);
        const relativePath = path.join(route.draftSubdir, params.relative_path);
        return buildToolText({
          route: route.key,
          route_label: route.label,
          official_root: route.officialRoot,
          ...(await writeDraftFile(config, relativePath, params.text, params.overwrite))
        });
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
        const fileName = `${Date.now()}-${path.basename(params.target_path).replace(/\.[^.]+$/, "")}.md`;
        return buildToolText(
          await preparePatchFile(
            config,
            fileName,
            params.target_path,
            params.summary,
            params.patch_body
          )
        );
      }
    },
    { optional: true }
  );

  api.registerTool(
    {
      name: "obsidian_bridge_prepare_routed_patch",
      description:
        "Prepare a patch draft for a specific business route without editing the official file directly.",
      parameters: {
        type: "object",
        properties: {
          route: { type: "string" },
          target_relative_path: { type: "string" },
          summary: { type: "string" },
          patch_body: { type: "string" }
        },
        required: ["route", "target_relative_path", "summary", "patch_body"],
        additionalProperties: false
      },
      async execute(_id, params) {
        const config = getConfig(api);
        ensureVaultConfigured(config);
        const route = resolveRoute(config, params.route);
        const fileName = `${Date.now()}-${route.key}-${path
          .basename(params.target_relative_path)
          .replace(/\.[^.]+$/, "")}.md`;
        const patchRelativePath = path.join(route.key, fileName);
        const officialTarget = path.join(route.officialRoot, params.target_relative_path);
        return buildToolText({
          route: route.key,
          route_label: route.label,
          ...(await preparePatchFile(
            config,
            patchRelativePath,
            officialTarget,
            params.summary,
            params.patch_body
          ))
        });
      }
    },
    { optional: true }
  );

  api.registerCli(
    ({ program }) => {
      const bridge = program
        .command("obsidian-bridge")
        .description("Inspect Obsidian bridge configuration.");

      bridge.command("status").action(() => {
        console.log(JSON.stringify(getConfig(api), null, 2));
      });

      bridge.command("routes").action(() => {
        const config = getConfig(api);
        ensureVaultConfigured(config);
        console.log(JSON.stringify({ routes: buildRoutesPayload(config) }, null, 2));
      });

      bridge
        .command("read")
        .requiredOption("--relative-path <relativePath>")
        .action(async (options) => {
          const config = getConfig(api);
          ensureVaultConfigured(config);
          const target = resolveInside(config.vaultRoot, options.relativePath);
          const text = await fsp.readFile(target, "utf8");
          console.log(
            JSON.stringify(
              {
                relative_path: options.relativePath,
                text
              },
              null,
              2
            )
          );
        });

      bridge
        .command("write-draft")
        .requiredOption("--relative-path <relativePath>")
        .requiredOption("--text <text>")
        .option("--overwrite")
        .action(async (options) => {
          const config = getConfig(api);
          ensureVaultConfigured(config);
          console.log(
            JSON.stringify(
              await writeDraftFile(
                config,
                options.relativePath,
                options.text,
                Boolean(options.overwrite)
              ),
              null,
              2
            )
          );
        });

      bridge
        .command("write-routed-draft")
        .requiredOption("--route <route>")
        .requiredOption("--relative-path <relativePath>")
        .requiredOption("--text <text>")
        .option("--overwrite")
        .action(async (options) => {
          const config = getConfig(api);
          ensureVaultConfigured(config);
          const route = resolveRoute(config, options.route);
          const relativePath = path.join(route.draftSubdir, options.relativePath);
          console.log(
            JSON.stringify(
              {
                route: route.key,
                route_label: route.label,
                official_root: route.officialRoot,
                ...(await writeDraftFile(
                  config,
                  relativePath,
                  options.text,
                  Boolean(options.overwrite)
                ))
              },
              null,
              2
            )
          );
        });

      bridge
        .command("prepare-patch")
        .requiredOption("--target-path <targetPath>")
        .requiredOption("--summary <summary>")
        .requiredOption("--patch-body <patchBody>")
        .action(async (options) => {
          const config = getConfig(api);
          ensureVaultConfigured(config);
          const fileName = `${Date.now()}-${path.basename(options.targetPath).replace(/\.[^.]+$/, "")}.md`;
          const payload = await preparePatchFile(
            config,
            fileName,
            options.targetPath,
            options.summary,
            options.patchBody
          );
          console.log(
            JSON.stringify(payload, null, 2)
          );
        });

      bridge
        .command("prepare-routed-patch")
        .requiredOption("--route <route>")
        .requiredOption("--target-relative-path <targetRelativePath>")
        .requiredOption("--summary <summary>")
        .requiredOption("--patch-body <patchBody>")
        .action(async (options) => {
          const config = getConfig(api);
          ensureVaultConfigured(config);
          const route = resolveRoute(config, options.route);
          const fileName = `${Date.now()}-${route.key}-${path
            .basename(options.targetRelativePath)
            .replace(/\.[^.]+$/, "")}.md`;
          const patchRelativePath = path.join(route.key, fileName);
          const officialTarget = path.join(route.officialRoot, options.targetRelativePath);
          const payload = await preparePatchFile(
            config,
            patchRelativePath,
            officialTarget,
            options.summary,
            options.patchBody
          );
          console.log(
            JSON.stringify(
              {
                route: route.key,
                route_label: route.label,
                ...payload
              },
              null,
              2
            )
          );
        });
    },
    { commands: ["obsidian-bridge"] }
  );
}
