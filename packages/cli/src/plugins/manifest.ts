/**
 * Claude Code and Grok Build plugin manifests, read into one component list.
 *
 * A plugin root holds `plugin.json`, `.grok-plugin/plugin.json` or `.claude-plugin/plugin.json` (the first one found
 * wins; the others are ignored), or no manifest and the conventional `skills/`, `commands/` and `.mcp.json`. A
 * manifest's `skills` or `commands` field replaces the conventional directory; a marketplace entry's fields add to
 * whatever the plugin declares (see `loadPlugin`).
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MANIFEST_PATHS = ["plugin.json", ".grok-plugin/plugin.json", ".claude-plugin/plugin.json"];

/** Components KnightCode does not run. A plugin that has them activates its other components with a warning. */
const UNSUPPORTED_FIELDS = ["hooks", "agents", "lspServers", "outputStyles", "userConfig", "dependencies"];
const UNSUPPORTED_PATHS: Record<string, string> = {
	hooks: "hooks/hooks.json",
	agents: "agents",
	lspServers: ".lsp.json",
	outputStyles: "output-styles",
};
/** Entry fields that conflict with a manifest when the entry is not strict. */
const NON_STRICT_CONFLICTS = ["commands", "agents", "skills", "hooks", "outputStyles"];

const MAX_NAME_LENGTH = 64;

/** The namespace form of a plugin name: lowercase `[a-z0-9-]`, trimmed of `-`, at most 64 characters. */
export function sanitizePluginName(name: string): string | undefined {
	const sanitized = name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_NAME_LENGTH)
		.replace(/-+$/, "");
	return sanitized || undefined;
}

export interface PluginCommandSource {
	/** Set for the object form of `commands`; file commands are named after the file. */
	name?: string;
	/** A Markdown file or a directory of them. */
	path?: string;
	/** An inline body. */
	content?: string;
	description?: string;
	argumentHint?: string;
}

export interface PluginComponents {
	/** Skill directories and single skill files, absolute. */
	skills: string[];
	commands: PluginCommandSource[];
	/** Server name → raw config, merged in declaration order. */
	mcpServers: Record<string, unknown>;
	/** Names of the unsupported components the plugin declares. */
	unsupported: string[];
}

/** The part of a marketplace entry that shapes the plugin it points at. */
export interface PluginEntryOverlay {
	name: string;
	description?: string;
	version?: string;
	/** Default true. */
	strict: boolean;
	/** The entry as written, for its component fields. */
	raw: Record<string, unknown>;
}

export interface LoadedPlugin {
	root: string;
	manifestPath?: string;
	/** The manifest's own name, for display. */
	displayName: string;
	/** The sanitized name used in commands, skills, MCP server names and storage paths. */
	namespace: string;
	description?: string;
	version?: string;
	components: PluginComponents;
	/** Problems that leave the plugin usable. */
	diagnostics: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * `path` resolved inside `root`, or an error. Absolute paths, `..` traversal and symlinks or junctions whose target
 * leaves the root are refused. A path that does not exist is returned as is; the caller decides whether it matters.
 */
export function resolveInsideRoot(root: string, path: string): string | { error: string } {
	if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.startsWith("\\")) {
		return { error: `component path "${path}" must be relative to the plugin root` };
	}
	const target = resolve(root, path);
	if (!isInside(root, target)) return { error: `component path "${path}" is outside the plugin root` };
	if (!existsSync(target)) return target;
	if (!isInside(realpathSync(root), realpathSync(target))) {
		return { error: `component path "${path}" links outside the plugin root` };
	}
	return target;
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf-8").replace(/^﻿/, ""));
	} catch (error) {
		throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function toPaths(value: unknown, field: string): string[] | { error: string } {
	if (typeof value === "string") return [value];
	if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
	return { error: `${field} must be a path or an array of paths` };
}

function isDirectory(path: string): boolean {
	return existsSync(path) && statSync(path).isDirectory();
}

class ComponentReader {
	readonly diagnostics: string[] = [];
	readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	/** Paths named by a `skills` or `commands` field, kept when they exist inside the root. */
	paths(value: unknown, field: string): string[] {
		const paths = toPaths(value, field);
		if ("error" in paths) {
			this.diagnostics.push(paths.error);
			return [];
		}
		const resolved: string[] = [];
		for (const path of paths) {
			const target = resolveInsideRoot(this.root, path);
			if (typeof target !== "string") this.diagnostics.push(`${field}: ${target.error}`);
			else if (!existsSync(target)) this.diagnostics.push(`${field}: "${path}" does not exist`);
			else resolved.push(target);
		}
		return resolved;
	}

	commands(value: unknown): PluginCommandSource[] {
		if (!isRecord(value)) return this.paths(value, "commands").map((path) => ({ path }));
		const commands: PluginCommandSource[] = [];
		for (const [name, spec] of Object.entries(value)) {
			if (!isRecord(spec)) {
				this.diagnostics.push(`commands.${name} must be an object`);
				continue;
			}
			const metadata = {
				...(typeof spec.description === "string" ? { description: spec.description } : {}),
				...(typeof spec["argument-hint"] === "string" ? { argumentHint: spec["argument-hint"] } : {}),
			};
			if (typeof spec.content === "string") {
				commands.push({ name, content: spec.content, ...metadata });
			} else if (typeof spec.source === "string") {
				const [path] = this.paths(spec.source, `commands.${name}`);
				if (path) commands.push({ name, path, ...metadata });
			} else {
				this.diagnostics.push(`commands.${name} needs "source" or "content"`);
			}
		}
		return commands;
	}

	/** Merges `mcpServers` (a path, an inline map, or an array of both) into `into`, later entries winning. */
	mcpServers(value: unknown, into: Record<string, unknown>): void {
		for (const item of Array.isArray(value) ? value : [value]) {
			if (isRecord(item)) {
				Object.assign(into, unwrapServers(item));
				continue;
			}
			if (typeof item !== "string") {
				this.diagnostics.push("mcpServers entries must be paths or server maps");
				continue;
			}
			if (/^[a-z][a-z0-9+.-]*:\/\//i.test(item) || item.endsWith(".mcpb")) {
				this.diagnostics.push(`mcpServers "${item}": MCPB bundles and URLs are not supported`);
				continue;
			}
			const target = resolveInsideRoot(this.root, item);
			if (typeof target !== "string") {
				this.diagnostics.push(`mcpServers: ${target.error}`);
				continue;
			}
			if (!existsSync(target)) {
				this.diagnostics.push(`mcpServers: "${item}" does not exist`);
				continue;
			}
			const parsed = readJson(target);
			if (!isRecord(parsed)) this.diagnostics.push(`mcpServers: "${item}" must hold a JSON object`);
			else Object.assign(into, unwrapServers(parsed));
		}
	}
}

/** `{ "mcpServers": { … } }` or a bare server map, as `.mcp.json` and inline maps accept both. */
function unwrapServers(value: Record<string, unknown>): Record<string, unknown> {
	return isRecord(value.mcpServers) ? value.mcpServers : value;
}

function findManifest(root: string): string | undefined {
	return MANIFEST_PATHS.map((path) => join(root, path)).find((path) => existsSync(path) && statSync(path).isFile());
}

/**
 * Reads the plugin at `root`. With `entry`, the plugin comes from a marketplace catalog, and the entry adds to or
 * stands in for the manifest:
 * - no manifest: the entry supplies the name, metadata and `mcpServers`; its `skills` and `commands` add to the
 *   conventional directories.
 * - a manifest and a strict entry (the default): the entry's `skills` and `commands` add to the manifest's, and its
 *   `mcpServers` are ignored.
 * - a manifest and `strict: false`: an entry that declares components conflicts with the manifest, and the plugin is
 *   rejected; `mcpServers` alone add to the manifest's.
 *
 * Throws when the directory is not a plugin or its manifest is malformed.
 */
export function loadPlugin(root: string, entry?: PluginEntryOverlay): LoadedPlugin {
	const manifestPath = findManifest(root);
	const parsed = manifestPath ? readJson(manifestPath) : undefined;
	if (manifestPath && !isRecord(parsed)) throw new Error(`${manifestPath}: the manifest must be a JSON object`);
	const manifest = isRecord(parsed) ? parsed : undefined;
	if (manifest && (typeof manifest.name !== "string" || !manifest.name.trim())) {
		throw new Error(`${manifestPath}: "name" must be a non-empty string`);
	}
	const reader = new ComponentReader(root);
	const conventional: { skills: string[]; commands: PluginCommandSource[]; mcp: boolean } = {
		skills: isDirectory(join(root, "skills")) ? [join(root, "skills")] : [],
		commands: isDirectory(join(root, "commands")) ? [{ path: join(root, "commands") }] : [],
		mcp: existsSync(join(root, ".mcp.json")),
	};
	if (!manifest && !entry && !conventional.skills.length && !conventional.commands.length && !conventional.mcp) {
		throw new Error(`${root} is not a plugin: it has no manifest, skills/, commands/ or .mcp.json`);
	}
	if (manifest && entry && !entry.strict) {
		const conflicts = NON_STRICT_CONFLICTS.filter((field) => entry.raw[field] !== undefined);
		if (conflicts.length > 0) {
			throw new Error(
				`marketplace entry "${entry.name}" conflicts with the plugin manifest: a non-strict entry cannot declare ${conflicts.join(", ")}`,
			);
		}
	}

	const own: Record<string, unknown> = manifest ?? {};
	const skills = own.skills !== undefined ? reader.paths(own.skills, "skills") : conventional.skills;
	const commands = own.commands !== undefined ? reader.commands(own.commands) : conventional.commands;
	const mcpServers: Record<string, unknown> = {};
	if (conventional.mcp) reader.mcpServers(".mcp.json", mcpServers);
	if (own.mcpServers !== undefined) reader.mcpServers(own.mcpServers, mcpServers);
	if (entry) {
		if (entry.raw.skills !== undefined) skills.push(...reader.paths(entry.raw.skills, "skills"));
		if (entry.raw.commands !== undefined) commands.push(...reader.commands(entry.raw.commands));
		// A strict entry's servers are ignored: the manifest is the plugin's own word on what it runs.
		if (entry.raw.mcpServers !== undefined && (!manifest || !entry.strict)) {
			reader.mcpServers(entry.raw.mcpServers, mcpServers);
		}
	}

	const unsupported = new Set<string>();
	for (const field of UNSUPPORTED_FIELDS) {
		if (
			own[field] !== undefined ||
			(entry && ["hooks", "agents", "lspServers"].includes(field) && entry.raw[field] !== undefined)
		) {
			unsupported.add(field);
		}
	}
	for (const [field, path] of Object.entries(UNSUPPORTED_PATHS)) {
		if (existsSync(join(root, path))) unsupported.add(field);
	}

	const displayName = typeof own.name === "string" ? own.name : (entry?.name ?? basename(root));
	const namespace = sanitizePluginName(displayName);
	if (!namespace) throw new Error(`plugin name "${displayName}" has no usable characters`);
	const description = typeof own.description === "string" ? own.description : manifest ? undefined : entry?.description;
	const version = typeof own.version === "string" ? own.version : manifest ? undefined : entry?.version;
	return {
		root,
		manifestPath,
		displayName,
		namespace,
		...(description !== undefined ? { description } : {}),
		...(version !== undefined ? { version } : {}),
		components: { skills, commands, mcpServers, unsupported: [...unsupported] },
		diagnostics: reader.diagnostics,
	};
}
