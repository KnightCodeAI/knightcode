/**
 * Marketplace catalogs: `.grok-plugin/marketplace.json`, `.grok-plugin/plugin.json`, `.claude-plugin/marketplace.json`
 * or `.claude-plugin/plugin.json`, whichever is found first. A `plugin.json` is a catalog only when it has a `plugins`
 * array; otherwise it is a plugin manifest and the probe moves on.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { isRecord, type PluginEntryOverlay, readJson } from "./manifest.ts";

const CATALOG_PATHS = [
	".grok-plugin/marketplace.json",
	".grok-plugin/plugin.json",
	".claude-plugin/marketplace.json",
	".claude-plugin/plugin.json",
];

/** Where a catalog entry's plugin lives. */
export type PluginSourceSpec =
	/** Relative to the marketplace root. */
	| { kind: "local"; path: string }
	/** A Git repository; `path` is the plugin's subdirectory in it. */
	| { kind: "git"; url: string; ref?: string; sha?: string; path?: string };

export interface MarketplaceEntry extends PluginEntryOverlay {
	source: PluginSourceSpec;
}

export interface MarketplaceCatalog {
	name: string;
	description?: string;
	catalogPath: string;
	plugins: MarketplaceEntry[];
	/** Entries that were skipped, and why. */
	diagnostics: string[];
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

/** A catalog entry's `source`, or why it cannot be installed. */
export function parseEntrySource(raw: unknown): PluginSourceSpec | { error: string } {
	if (typeof raw === "string") return { kind: "local", path: raw };
	if (!isRecord(raw)) return { error: "source must be a path or an object" };
	const kind = optionalString(raw.source) ?? optionalString(raw.type);
	// Anything else would be looked up as a ref, and the pin would follow a branch.
	if (raw.sha !== undefined && !(typeof raw.sha === "string" && /^[0-9a-f]{40}$/i.test(raw.sha))) {
		return { error: "sha must be a full 40-character commit SHA" };
	}
	const pins = {
		...(optionalString(raw.ref) ? { ref: raw.ref as string } : {}),
		...(optionalString(raw.sha) ? { sha: raw.sha as string } : {}),
	};
	const subdir = optionalString(raw.path) ? { path: raw.path as string } : {};
	switch (kind) {
		case "local":
			return optionalString(raw.path)
				? { kind: "local", path: raw.path as string }
				: { error: "local source needs path" };
		case "github": {
			const repo = optionalString(raw.repo);
			if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: "github source needs repo as owner/name" };
			return { kind: "git", url: `https://github.com/${repo.replace(/\.git$/, "")}.git`, ...pins };
		}
		case "url":
		case "git-subdir": {
			const url = optionalString(raw.url);
			if (!url) return { error: `${kind} source needs url` };
			if (kind === "git-subdir" && !subdir.path) return { error: "git-subdir source needs path" };
			return { kind: "git", url, ...subdir, ...pins };
		}
		default:
			return { error: `unsupported source ${kind === undefined ? "(no kind)" : `"${kind}"`}` };
	}
}

/** Reads the catalog at `root`. Throws when there is none or it is malformed. */
export function readMarketplace(root: string): MarketplaceCatalog {
	let catalogPath: string | undefined;
	let catalog: Record<string, unknown> | undefined;
	for (const path of CATALOG_PATHS) {
		const candidate = join(root, path);
		if (!existsSync(candidate)) continue;
		// A plugin.json is a catalog only when it lists plugins; any other, even a malformed one, is a plugin's own.
		let parsed: unknown;
		try {
			parsed = readJson(candidate);
		} catch (error) {
			if (path.endsWith("plugin.json")) continue;
			throw error;
		}
		if (path.endsWith("plugin.json") && !(isRecord(parsed) && Array.isArray(parsed.plugins))) continue;
		if (!isRecord(parsed) || !Array.isArray(parsed.plugins))
			throw new Error(`${candidate}: "plugins" must be an array`);
		catalogPath = candidate;
		catalog = parsed;
		break;
	}
	if (!catalogPath || !catalog) throw new Error(`${root} has no marketplace catalog (${CATALOG_PATHS.join(", ")})`);
	const name = optionalString(catalog.name);
	if (!name) throw new Error(`${catalogPath}: "name" must be a non-empty string`);

	const diagnostics: string[] = [];
	const plugins: MarketplaceEntry[] = [];
	for (const raw of catalog.plugins as unknown[]) {
		const entryName = isRecord(raw) ? optionalString(raw.name) : undefined;
		if (!isRecord(raw) || !entryName) {
			diagnostics.push("skipped a catalog entry without a name");
			continue;
		}
		if (plugins.some((other) => other.name === entryName)) {
			diagnostics.push(`${entryName}: listed twice; the first entry is used`);
			continue;
		}
		const source = parseEntrySource(raw.source);
		if ("error" in source) {
			diagnostics.push(`${entryName}: ${source.error}`);
			continue;
		}
		const description = optionalString(raw.description);
		const version = optionalString(raw.version);
		plugins.push({
			name: entryName,
			...(description ? { description } : {}),
			...(version ? { version } : {}),
			strict: raw.strict !== false,
			source,
			raw,
		});
	}
	const description =
		optionalString(catalog.description) ?? optionalString((catalog.metadata as { description?: unknown })?.description);
	return { name, ...(description ? { description } : {}), catalogPath, plugins, diagnostics };
}
