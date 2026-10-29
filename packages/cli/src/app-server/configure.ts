/**
 * What the terminal configures outside settings.json, for the desktop's settings pages: the KnightCode tools of
 * `/tools` (tools.json), the MCP servers of `/mcp` and `knightcode mcp` (mcp.json), and the extensions, skills,
 * prompts and themes of `knightcode config` (patterns in settings.json). Each write lands in the same file the
 * terminal writes, so both see one state; loaded threads pick changes up when they next load.
 */

import { basename, dirname, join, relative } from "node:path";
import type { ParamsOf, Resource, ResourceType } from "@knightcode/app-server-protocol";
import { TOOLS } from "@knightcode/tools/registry";
import { maskKey } from "@knightcode/tools/settings";
import { readPersisted, resolveEnabled, updateSettings } from "@knightcode/tools/state";
import { CONFIG_DIR_NAME } from "../config.ts";
import { DefaultPackageManager, type ResolvedResource } from "../core/package-manager.ts";
import { validateMcpServerConfig } from "../core/mcp-servers.ts";
import { type PackageSource, SettingsManager } from "../core/settings-manager.ts";
import { ProjectTrustStore } from "../core/trust-manager.ts";
import {
	addMcpServerConfig,
	loadMcpConfig,
	removeMcpServerConfig,
	updateMcpServerConfig,
} from "../extensions/mcp/config.ts";
import { resolvePath } from "../utils/paths.ts";
import { writeSetting } from "./config.ts";
import type { AppServerContext } from "./context.ts";
import { AppServerError } from "./errors.ts";
import type { Handlers } from "./server.ts";
import { projectReadable, trustKey } from "./workspaces.ts";

const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"] as const satisfies readonly ResourceType[];

/** A project directory the user explicitly trusted, as project writes require (config/write does the same). */
function trustedProject(agentDir: string, cwd: string | undefined): string {
	if (cwd === undefined) throw new AppServerError("invalidParams", "project writes require cwd");
	const resolved = resolvePath(cwd);
	if (new ProjectTrustStore(agentDir).get(trustKey(agentDir, resolved)) !== true)
		throw new AppServerError("invalidParams", "project is not trusted", { reason: "untrusted" });
	return resolved;
}

/** The name `knightcode config` shows for a resource. */
function resourceName(type: ResourceType, path: string): string {
	const parent = basename(dirname(path));
	if (type === "extensions" && parent !== "extensions") return `${parent}/${basename(path)}`;
	if (type === "skills" && basename(path) === "SKILL.md") return parent;
	return basename(path);
}

/** Resources as a session in `cwd` would load them; without cwd, the user's own. */
async function resolveResources(agentDir: string, cwd: string | undefined) {
	const projectTrusted = cwd !== undefined && projectReadable(agentDir, cwd);
	// The agent directory has no `.knightcode` of its own, so it stands for "no project".
	const settings = SettingsManager.create(cwd ?? agentDir, agentDir, { projectTrusted });
	const resolved = await new DefaultPackageManager({
		cwd: cwd ?? agentDir,
		agentDir,
		// No built-in extensions: they are part of KnightCode, always on, so never listed or turned off.
		settingsManager: settings,
	}).resolve(async () => "skip");
	return { settings, resolved };
}

/** `entries` without any `+`, `-` or `!` entry for `pattern`, then the one that loads or skips it. */
function withToggle(entries: readonly string[], pattern: string, enabled: boolean): string[] {
	return [...entries.filter((entry) => entry.replace(/^[+\-!]/, "") !== pattern), `${enabled ? "+" : "-"}${pattern}`];
}

/**
 * Loads or skips one resource where `knightcode config` would: a top-level one by a pattern in the `extensions`,
 * `skills`, `prompts` or `themes` setting of its own scope, a package's by a filter on that package's entry.
 */
function toggleResource(
	agentDir: string,
	cwd: string | undefined,
	settings: SettingsManager,
	type: ResourceType,
	{ path, metadata }: ResolvedResource,
	enabled: boolean,
): void {
	const scope = metadata.scope === "project" ? "project" : "global";
	const projectCwd = scope === "project" ? trustedProject(agentDir, cwd) : cwd;
	const own = scope === "project" ? settings.getProjectSettings() : settings.getGlobalSettings();
	if (metadata.origin === "top-level") {
		const baseDir = metadata.baseDir ?? (scope === "project" ? join(projectCwd!, CONFIG_DIR_NAME) : agentDir);
		writeSetting(
			agentDir,
			projectCwd,
			scope,
			[type],
			withToggle((own[type] ?? []) as string[], relative(baseDir, path), enabled),
		);
		return;
	}
	const packages = [...(own.packages ?? [])] as PackageSource[];
	const index = packages.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === metadata.source);
	if (index === -1) throw new AppServerError("invalidParams", `no package ${metadata.source} in ${scope} settings`);
	const current = packages[index];
	const pkg: Exclude<PackageSource, string> = typeof current === "string" ? { source: current } : { ...current };
	pkg[type] = withToggle(pkg[type] ?? [], relative(metadata.baseDir ?? dirname(path), path), enabled);
	packages[index] = pkg;
	writeSetting(agentDir, projectCwd, scope, ["packages"], packages);
}

export function configureHandlers(ctx: AppServerContext): Handlers {
	const toolsFile = join(ctx.agentDir, "tools.json");
	const globalMcp = join(ctx.agentDir, "mcp.json");
	const mcpConfig = (cwd: string | undefined) => {
		const resolved = cwd === undefined ? undefined : resolvePath(cwd);
		return loadMcpConfig({
			agentDir: ctx.agentDir,
			cwd: resolved ?? ctx.agentDir,
			projectTrusted:
				resolved !== undefined && new ProjectTrustStore(ctx.agentDir).get(trustKey(ctx.agentDir, resolved)) === true,
		});
	};
	const mcpPath = (scope: ParamsOf<"mcp/add">["scope"], cwd: string | undefined) =>
		scope === "project" ? join(trustedProject(ctx.agentDir, cwd), CONFIG_DIR_NAME, "mcp.json") : globalMcp;
	return {
		"tool/settings/read": async () => {
			const persisted = readPersisted(toolsFile);
			return {
				tools: TOOLS.map(({ tool, defaultEnabled }) => {
					const { enabled: _, ...rest } = persisted[tool.name] ?? {};
					// Stored keys (a search API key) never leave the server whole.
					const settings = Object.fromEntries(
						Object.entries(rest).map(([key, value]) => [
							key,
							typeof value === "string" && /Key$/.test(key) ? maskKey(value) : value,
						]),
					);
					return {
						name: tool.name,
						enabled: resolveEnabled(tool.name, defaultEnabled, persisted, new Map()),
						settings,
					};
				}),
				classifiers: ctx.models
					.getModelsOfType("classifier")
					.filter((model) => ctx.models.hasConfiguredAuth(model.provider))
					.map((model) => ({ provider: model.provider, id: model.id, name: model.name })),
			};
		},
		"tool/settings/write": async ({ name, key, value }) => {
			if (!TOOLS.some((entry) => entry.tool.name === name))
				throw new AppServerError("invalidParams", `unknown tool: ${name}`);
			if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || (key === "enabled") !== (typeof value === "boolean"))
				throw new AppServerError("invalidParams", `invalid setting ${key} for ${name}`);
			await updateSettings(name, { [key]: value ?? undefined }, toolsFile);
			return {};
		},
		"mcp/list": async ({ cwd }) => {
			const loaded = mcpConfig(cwd);
			return {
				servers: loaded.servers.map(({ name, config, source, scope, override }) => ({
					name,
					scope: scope === "project" ? ("project" as const) : ("global" as const),
					source,
					...(override ? { override } : {}),
					transport: "url" in config ? ("http" as const) : ("stdio" as const),
					target: "url" in config ? config.url : [config.command, ...(config.args ?? [])].join(" "),
					...(config.description ? { description: config.description } : {}),
					enabled: config.enabled !== false,
					exposure: config.exposure ?? "codemode",
				})),
				errors: loaded.errors,
				paths: { global: globalMcp, ...(loaded.projectConfig ? { project: loaded.projectConfig } : {}) },
			};
		},
		"mcp/update": async ({ cwd, name, enabled, exposure }) => {
			const entry = mcpConfig(cwd).servers.find((server) => server.name === name);
			if (!entry) throw new AppServerError("invalidParams", `no MCP server named ${name}`);
			updateMcpServerConfig(
				entry.override ?? entry.source,
				name,
				{ enabled, exposure },
				{ override: entry.override !== undefined },
			);
			return {};
		},
		"mcp/add": async ({ scope, cwd, name, config }) => {
			const validated = validateMcpServerConfig(name, config);
			if (typeof validated === "string") throw new AppServerError("invalidParams", validated);
			// A repository must not pick where a provider's credential is sent (mcp/config.ts).
			if (scope === "project" && "url" in validated && validated.auth)
				throw new AppServerError("invalidParams", "auth is only allowed in the global mcp.json");
			return { replaced: addMcpServerConfig(mcpPath(scope, cwd), name, validated) };
		},
		"mcp/remove": async ({ scope, cwd, name }) => ({ removed: removeMcpServerConfig(mcpPath(scope, cwd), name) }),
		"resource/list": async ({ cwd }) => {
			const { resolved } = await resolveResources(ctx.agentDir, cwd === undefined ? undefined : resolvePath(cwd));
			const resources: Resource[] = RESOURCE_TYPES.flatMap((type) =>
				resolved[type].map(({ path, enabled, metadata }) => ({
					type,
					path,
					name: resourceName(type, path),
					enabled,
					scope: metadata.scope,
					origin: metadata.origin,
					source: metadata.source,
				})),
			);
			return { resources };
		},
		"resource/set": async ({ cwd, type, path, enabled }) => {
			const resolvedCwd = cwd === undefined ? undefined : resolvePath(cwd);
			const { settings, resolved } = await resolveResources(ctx.agentDir, resolvedCwd);
			const resource = resolved[type].find((candidate) => candidate.path === path);
			if (!resource) throw new AppServerError("invalidParams", `no ${type} resource at ${path}`);
			// Loaded from a command-line flag for one session: there is no settings entry to turn it on or off.
			if (resource.metadata.scope === "temporary")
				throw new AppServerError("invalidParams", `${path} is loaded for this session only`);
			toggleResource(ctx.agentDir, resolvedCwd, settings, type, resource, enabled);
			return {};
		},
	};
}
