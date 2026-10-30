/**
 * Rendering: once per revision, inside the staged copy, before it is moved into place. Skill and command files are
 * rewritten where they are, so relative references such as `../../scripts/x.py` keep resolving, and the result is an
 * inventory of what the plugin offers. Sessions read the inventory and the rendered files; they rewrite nothing.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { stringify } from "yaml";
import { mcpNamespace } from "../core/mcp-servers.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { type LoadedPlugin, sanitizePluginName } from "./manifest.ts";
import { forwardSlashes } from "./sources.ts";

export interface InventorySkill {
	/** `<plugin>:<skill>`. */
	name: string;
	/** Relative to the plugin root, with `/`. */
	file: string;
	description: string;
	/** False when the frontmatter says `user-invocable: false`: no `/<plugin>:<skill>` command. */
	userInvocable: boolean;
	/** Names of positional arguments, from the `arguments` frontmatter. */
	arguments: string[];
	argumentHint?: string;
}

export interface InventoryCommand {
	/** Without the plugin prefix. */
	name: string;
	file?: string;
	content?: string;
	description: string;
	argumentHint?: string;
	arguments: string[];
}

export interface PluginInventory {
	name: string;
	namespace: string;
	description?: string;
	version?: string;
	skills: InventorySkill[];
	commands: InventoryCommand[];
	/** Server name as the plugin wrote it → raw config. Translated when a session registers it. */
	mcpServers: Record<string, unknown>;
	unsupported: string[];
	/** Partial-compatibility warnings and format problems. */
	warnings: string[];
}

/** Frontmatter keys that ask the host to change how the prompt runs. KnightCode ignores them. */
const EXECUTION_FRONTMATTER = ["allowed-tools", "model", "effort", "context", "agent", "hooks", "shell"];
const LITERAL_TOKENS = [/\$\{CLAUDE_SESSION_ID\}/, /\$\{SESSION_ID\}/, /\$\{user_config\.[^}]*\}/];
const MAX_DESCRIPTION_LENGTH = 1024;

/** `plugin_<plugin>_<server>` with characters outside `[A-Za-z0-9_-]` replaced and runs of `_` collapsed. */
export function pluginServerName(namespace: string, server: string): string {
	return `plugin_${namespace}_${server}`.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
}

function replaceAll(text: string, tokens: Record<string, string>): string {
	let result = text;
	for (const [token, value] of Object.entries(tokens)) result = result.split(token).join(value);
	return result;
}

/** First paragraph, else first heading, else `fallback`, on one line. */
export function deriveDescription(body: string, fallback: string): string {
	const blocks = body
		.split(/\n\s*\n/)
		.map((block) => block.trim())
		.filter(Boolean);
	const paragraph = blocks.find((block) => !block.startsWith("#") && !block.startsWith("```"));
	const heading = blocks
		.find((block) => block.startsWith("#"))
		?.split("\n")[0]
		?.replace(/^#+\s*/, "");
	const text = (paragraph ?? heading ?? fallback).replace(/\s+/g, " ").trim() || fallback;
	return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…` : text;
}

function argumentNames(value: unknown): string[] {
	const names = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\s+/) : [];
	return names.filter((name): name is string => typeof name === "string" && name.trim() !== "" && !/^\d+$/.test(name));
}

function markdownFiles(dir: string): string[] {
	return readdirSync(dir)
		.sort()
		.flatMap((name) => {
			if (name.startsWith(".") || name === "node_modules") return [];
			const path = join(dir, name);
			if (statSync(path).isDirectory()) return markdownFiles(path);
			return name.endsWith(".md") ? [path] : [];
		});
}

/** `SKILL.md` files: the directory's own, or else those of its subdirectories, recursively. */
function skillFiles(dir: string): string[] {
	if (existsSync(join(dir, "SKILL.md"))) return [join(dir, "SKILL.md")];
	return readdirSync(dir)
		.sort()
		.flatMap((name) => {
			const path = join(dir, name);
			return !name.startsWith(".") && name !== "node_modules" && statSync(path).isDirectory() ? skillFiles(path) : [];
		});
}

function serialize(frontmatter: Record<string, unknown>, body: string): string {
	return `---\n${stringify(frontmatter).trimEnd()}\n---\n${body}\n`;
}

export interface RenderOptions {
	/** Where the revision will live: what `${CLAUDE_PLUGIN_ROOT}` names. */
	root: string;
	/** What `${CLAUDE_PLUGIN_DATA}` names. */
	dataDir: string;
}

/** Rewrites the plugin's skill and command files in place (under `plugin.root`) and returns its inventory. */
export function renderPlugin(plugin: LoadedPlugin, options: RenderOptions): PluginInventory {
	const warnings = [...plugin.diagnostics];
	const finalRoot = forwardSlashes(options.root);
	const rootTokens: Record<string, string> = {
		"${CLAUDE_PLUGIN_ROOT}": finalRoot,
		"${GROK_PLUGIN_ROOT}": finalRoot,
		"${CLAUDE_PLUGIN_DATA}": forwardSlashes(options.dataDir),
		"${GROK_PLUGIN_DATA}": forwardSlashes(options.dataDir),
	};
	// Skills and commands name the plugin's tools the way Claude Code does; KnightCode turns `-` into `_` as well.
	for (const server of Object.keys(plugin.components.mcpServers)) {
		const claudeServer = `plugin_${plugin.displayName}_${server}`.replace(/[^A-Za-z0-9_-]/g, "_");
		rootTokens[`mcp__${claudeServer}__`] = `${mcpNamespace(pluginServerName(plugin.namespace, server))}__`;
	}
	const relativePath = (path: string) => forwardSlashes(relative(plugin.root, path));

	const checkCompatibility = (where: string, frontmatter: Record<string, unknown>, body: string) => {
		const keys = EXECUTION_FRONTMATTER.filter((key) => frontmatter[key] !== undefined);
		if (keys.length) warnings.push(`${where}: ignores frontmatter ${keys.join(", ")}`);
		if (/!`[^`]+`/.test(body)) warnings.push(`${where}: does not run !\`cmd\` shell preprocessing`);
		for (const token of LITERAL_TOKENS) {
			const match = body.match(token);
			if (match) warnings.push(`${where}: leaves ${match[0]} unsubstituted`);
		}
	};

	/** A file whose frontmatter does not parse is skipped, so one broken file never fails the whole plugin. */
	const parse = (text: string, where: string) => {
		try {
			return parseFrontmatter<Record<string, unknown>>(text);
		} catch (error) {
			const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
			warnings.push(`${where}: skipped, its frontmatter is not valid YAML (${reason})`);
			return undefined;
		}
	};

	const rendered = new Set<string>();
	const skills: InventorySkill[] = [];
	for (const path of plugin.components.skills) {
		const files = statSync(path).isDirectory() ? skillFiles(path) : [path];
		for (const file of files) {
			if (rendered.has(file)) continue;
			rendered.add(file);
			const parsed = parse(readFileSync(file, "utf-8"), relativePath(file));
			if (!parsed) continue;
			const { frontmatter, body } = parsed;
			const fallbackName = basename(file) === "SKILL.md" ? basename(dirname(file)) : basename(file, ".md");
			const ownName =
				(typeof frontmatter.name === "string" && sanitizePluginName(frontmatter.name.split(":").pop() ?? "")) ||
				sanitizePluginName(fallbackName) ||
				"skill";
			const name = `${plugin.namespace}:${ownName}`;
			const skillDir = [finalRoot, relativePath(dirname(file))].filter(Boolean).join("/");
			checkCompatibility(`skill "${name}"`, frontmatter, body);
			const renderedBody = replaceAll(body, {
				...rootTokens,
				"${CLAUDE_SKILL_DIR}": skillDir,
				"${SKILL_DIR}": skillDir,
			});
			const description =
				typeof frontmatter.description === "string" && frontmatter.description.trim()
					? frontmatter.description
					: deriveDescription(renderedBody, ownName);
			writeFileSync(file, serialize({ ...frontmatter, name, description }, renderedBody));
			skills.push({
				name,
				file: relativePath(file),
				description,
				userInvocable: frontmatter["user-invocable"] !== false,
				arguments: argumentNames(frontmatter.arguments),
				...(typeof frontmatter["argument-hint"] === "string" ? { argumentHint: frontmatter["argument-hint"] } : {}),
			});
		}
	}

	const skillNames = new Set(skills.map((skill) => skill.name.slice(plugin.namespace.length + 1)));
	const commands: InventoryCommand[] = [];
	const addCommand = (command: InventoryCommand) => {
		if (skillNames.has(command.name)) {
			warnings.push(`command "${command.name}" is hidden by the skill of the same name`);
		} else if (commands.some((other) => other.name === command.name)) {
			warnings.push(`command "${command.name}" is declared twice; the first one is used`);
		} else {
			commands.push(command);
		}
	};
	const renderCommand = (
		source: string,
		rawName: string,
		where: string,
		overrides: { description?: string; argumentHint?: string },
	) => {
		// Command names cannot hold whitespace: the command parser reads the name up to the first space.
		const name = rawName.trim().replace(/\s+/g, "-");
		const parsed = parse(source, where);
		if (!parsed) return undefined;
		const { frontmatter, body } = parsed;
		checkCompatibility(`command "${name}"`, frontmatter, body);
		const renderedBody = replaceAll(body, rootTokens);
		const hint = overrides.argumentHint ?? frontmatter["argument-hint"];
		return {
			frontmatter,
			body: renderedBody,
			command: {
				name,
				description:
					overrides.description ??
					(typeof frontmatter.description === "string" && frontmatter.description.trim()
						? frontmatter.description
						: deriveDescription(renderedBody, name)),
				...(typeof hint === "string" ? { argumentHint: hint } : {}),
				arguments: argumentNames(frontmatter.arguments),
			},
		};
	};
	for (const source of plugin.components.commands) {
		if (source.content !== undefined) {
			const result = renderCommand(source.content, source.name ?? "command", `command "${source.name}"`, source);
			if (result) addCommand({ content: result.body, ...result.command });
			continue;
		}
		if (!source.path) continue;
		const isDir = statSync(source.path).isDirectory();
		for (const file of isDir ? markdownFiles(source.path) : [source.path]) {
			const name =
				source.name ??
				(isDir ? relative(source.path, file) : basename(file)).replace(/\.md$/, "").split(/[\\/]/).join(":");
			const raw = readFileSync(file, "utf-8");
			const result = renderCommand(raw, name, relativePath(file), source);
			if (!result) continue;
			const { frontmatter, body, command } = result;
			if (!rendered.has(file)) {
				rendered.add(file);
				const keepsFrontmatter = Object.keys(frontmatter).length > 0;
				writeFileSync(file, keepsFrontmatter ? serialize(frontmatter, body) : replaceAll(raw, rootTokens));
			}
			addCommand({ file: relativePath(file), ...command });
		}
	}

	return {
		name: plugin.displayName,
		namespace: plugin.namespace,
		...(plugin.description !== undefined ? { description: plugin.description } : {}),
		...(plugin.version !== undefined ? { version: plugin.version } : {}),
		skills,
		commands,
		mcpServers: plugin.components.mcpServers,
		unsupported: plugin.components.unsupported,
		warnings,
	};
}
