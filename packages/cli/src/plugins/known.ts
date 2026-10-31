/**
 * Marketplaces and plugins KnightCode knows about without being told: Anthropic's and xAI's official catalogs, and
 * what Claude Code (`~/.claude`, or `CLAUDE_CONFIG_DIR`) and Grok Build (`~/.grok`, or `GROK_HOME`) already have.
 * Read only: nothing here is fetched, added or trusted. The user adds a marketplace or installs a plugin, and that
 * install asks for trust like any other; trust in those tools never carries over.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRecord } from "./manifest.ts";
import { parseSource } from "./sources.ts";

export type KnownOrigin = "Anthropic" | "xAI" | "Claude Code" | "Grok Build";

export interface KnownMarketplace {
	name: string;
	/** As `knightcode plugin marketplace add` takes it. */
	source: string;
	ref?: string;
	from: KnownOrigin;
}

/** A plugin Claude Code or Grok Build installed for the user. */
export interface ForeignPlugin {
	name: string;
	from: "Claude Code" | "Grok Build";
	/** The marketplace it came from: its name there, and its source when that tool records one. */
	marketplace: { name?: string; source?: string };
	/** False when that tool has it turned off. */
	enabled: boolean;
}

export const BUILT_IN_MARKETPLACES: readonly KnownMarketplace[] = [
	{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", from: "Anthropic" },
	{ name: "xai-official", source: "xai-org/plugin-marketplace", from: "xAI" },
];

function claudeDir(): string {
	return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function grokDir(): string {
	return process.env.GROK_HOME || join(homedir(), ".grok");
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}

/** The repository or directory a marketplace source names, or undefined when it does not parse. */
export function marketplaceKey(source: string): string | undefined {
	const parsed = parseSource(source, homedir());
	return "error" in parsed || parsed.kind === "marketplace" ? undefined : parsed.canonical;
}

/**
 * `{ name: { source: { source: "github", repo } } }`, the shape of `known_marketplaces.json` and of
 * `extraKnownMarketplaces`. Sources other than a repository or a directory (a catalog URL, npm) are skipped.
 */
function marketplaceMap(raw: unknown, from: KnownOrigin): KnownMarketplace[] {
	if (!isRecord(raw)) return [];
	return Object.entries(raw).flatMap(([name, entry]) => {
		const source = isRecord(entry) && isRecord(entry.source) ? entry.source : {};
		const location =
			source.source === "github"
				? source.repo
				: source.source === "git"
					? source.url
					: source.source === "directory" || source.source === "local"
						? source.path
						: undefined;
		if (typeof location !== "string" || !location) return [];
		return [{ name, source: location, ...(typeof source.ref === "string" ? { ref: source.ref } : {}), from }];
	});
}

/** A tool's marketplaces: its settings' `extraKnownMarketplaces`, then its `plugins/known_marketplaces.json`. */
function toolMarketplaces(dir: string, from: KnownOrigin): KnownMarketplace[] {
	return [
		...["settings.local.json", "settings.json"].flatMap((file) => {
			const settings = readJson(join(dir, file));
			return marketplaceMap(isRecord(settings) ? settings.extraKnownMarketplaces : undefined, from);
		}),
		...marketplaceMap(readJson(join(dir, "plugins", "known_marketplaces.json")), from),
	];
}

/**
 * The copies Claude Code and Grok Build keep of marketplaces, by repository (`marketplaceKey`): Claude Code's
 * `known_marketplaces.json` names each `installLocation`, and Grok Build clones into `marketplace-cache/`. Their
 * catalog files show at once, before KnightCode fetches its own copy; nothing in them is installed or run.
 */
export function toolClones(): Map<string, string> {
	const clones = new Map<string, string>();
	const known = readJson(join(claudeDir(), "plugins", "known_marketplaces.json"));
	for (const [name, entry] of Object.entries(isRecord(known) ? known : {})) {
		const [market] = marketplaceMap({ [name]: entry }, "Claude Code");
		const key = market && marketplaceKey(market.source);
		if (key && isRecord(entry) && typeof entry.installLocation === "string") clones.set(key, entry.installLocation);
	}
	const cache = join(grokDir(), "marketplace-cache");
	let dirs: string[] = [];
	try {
		dirs = readdirSync(cache);
	} catch {}
	for (const dir of dirs) {
		let config: string;
		try {
			config = readFileSync(join(cache, dir, ".git", "config"), "utf-8");
		} catch {
			continue;
		}
		// `[ \t]`, not `\s`: under `m`, `^\s*` spans blank lines, which is quadratic on a long run of them.
		const url = /^[ \t]*url[ \t]*=[ \t]*(\S+)/m.exec(config)?.[1];
		const key = url && marketplaceKey(url);
		if (key && !clones.has(key)) clones.set(key, join(cache, dir));
	}
	return clones;
}

/** The built-in marketplaces, then Claude Code's and Grok Build's; the first of each repository and each name. */
export function knownMarketplaces(): KnownMarketplace[] {
	const seen = new Set<string>();
	return [
		...BUILT_IN_MARKETPLACES,
		...toolMarketplaces(claudeDir(), "Claude Code"),
		...toolMarketplaces(grokDir(), "Grok Build"),
	].filter((market) => {
		const key = marketplaceKey(market.source);
		if (!key || seen.has(key) || seen.has(`name:${market.name}`)) return false;
		seen.add(key).add(`name:${market.name}`);
		return true;
	});
}

/**
 * Plugins Claude Code (`plugins/installed_plugins.json`) and Grok Build (`installed-plugins/registry.json`)
 * installed for the user. Claude Code's project and local installs belong to one project and are left out.
 */
export function foreignPlugins(): ForeignPlugin[] {
	const claude = claudeDir();
	const enabled: Record<string, unknown> = {};
	for (const file of ["settings.json", "settings.local.json"]) {
		const settings = readJson(join(claude, file));
		if (isRecord(settings) && isRecord(settings.enabledPlugins)) Object.assign(enabled, settings.enabledPlugins);
	}
	const claudeMarkets = new Map(toolMarketplaces(claude, "Claude Code").map((market) => [market.name, market.source]));
	const installed = readJson(join(claude, "plugins", "installed_plugins.json"));
	const fromClaude = Object.entries(
		isRecord(installed) && isRecord(installed.plugins) ? installed.plugins : {},
	).flatMap(([key, entries]): ForeignPlugin[] => {
		const forUser = (Array.isArray(entries) ? entries : [entries]).some(
			(entry) => isRecord(entry) && (entry.scope === "user" || (entry.scope === undefined && !entry.projectPath)),
		);
		const [name, market] = key.split("@");
		if (!forUser || !name) return [];
		const source = market ? claudeMarkets.get(market) : undefined;
		return [
			{
				name,
				from: "Claude Code",
				marketplace: { ...(market ? { name: market } : {}), ...(source ? { source } : {}) },
				enabled: enabled[key] !== false,
			},
		];
	});
	const registry = readJson(join(grokDir(), "installed-plugins", "registry.json"));
	const fromGrok = Object.values(isRecord(registry) && isRecord(registry.repos) ? registry.repos : {}).flatMap(
		(repo): ForeignPlugin[] => {
			if (!isRecord(repo) || !isRecord(repo.plugins)) return [];
			const source =
				isRecord(repo.marketplace) && typeof repo.marketplace.source_url_or_path === "string"
					? repo.marketplace.source_url_or_path
					: undefined;
			return Object.keys(repo.plugins).map((name) => ({
				name,
				from: "Grok Build",
				marketplace: source ? { source } : {},
				enabled: true,
			}));
		},
	);
	return [...fromClaude, ...fromGrok];
}
