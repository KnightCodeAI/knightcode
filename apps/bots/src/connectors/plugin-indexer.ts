// The plugin source (spec section 9): a scheduled job reads the official plugin marketplaces (the same two the CLI
// builds in) over HTTPS, without git, and indexes plugins that offer a remote MCP server as connectors and plugins
// that only add skills as skills. Trust and inventory checks as in the CLI: safe names, no paths leaving the
// marketplace, HTTPS servers only, bounded sizes and counts. Nothing from a plugin runs in the Worker: hooks, local
// commands and skill scripts are recorded, never executed (local MCP servers run on the user's computer).
import type { CatalogEntry } from "@knightcode/bots-protocol";
import { DEFAULT_PERMISSIONS } from "./permissions.ts";

/** The CLI's built-in marketplaces (packages/cli/src/plugins/known.ts). */
export const MARKETPLACES = [
	{ name: "claude-plugins-official", repo: "anthropics/claude-plugins-official" },
	{ name: "xai-official", repo: "xai-org/plugin-marketplace" },
] as const;

/** Catalog files, in the order the CLI probes them. */
const CATALOG_PATHS = [".grok-plugin/marketplace.json", ".claude-plugin/marketplace.json"];
const MAX_PLUGINS = 500;
const MAX_FILE_BYTES = 256 * 1024;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface IndexedPlugin {
	entry: CatalogEntry;
	/** Remote MCP servers: HTTPS only. */
	servers: { name: string; url: string }[];
	skills: { name: string; description: string; path: string }[];
	/** Parts recorded but never run in the Worker. */
	inert: string[];
}

type Fetcher = (url: string) => Promise<Response>;

async function getText(fetcher: Fetcher, url: string): Promise<string | undefined> {
	const response = await fetcher(url);
	if (!response.ok) return undefined;
	const text = await response.text();
	return text.length > MAX_FILE_BYTES ? undefined : text;
}

async function getJson<T>(fetcher: Fetcher, url: string): Promise<T | undefined> {
	const text = await getText(fetcher, url);
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

/** A plugin path inside its marketplace: relative, no "..", no backslashes. */
export function safePath(path: string): string | undefined {
	const trimmed = path.replace(/^\.\//, "").replace(/\/$/, "");
	if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.split("/").some((part) => part === ".." || part === "")) return undefined;
	return trimmed;
}

const raw = (repo: string, path: string) => `https://raw.githubusercontent.com/${repo}/HEAD/${path}`;

type MarketplaceFile = { plugins?: { name?: unknown; description?: unknown; source?: unknown; category?: unknown; author?: { name?: unknown } }[] };
type McpFile = { mcpServers?: Record<string, { type?: string; url?: string; command?: string }> };
type PluginFile = { hooks?: unknown; commands?: unknown; description?: string };

/** One marketplace's plugins; skipped entries are left out silently, as the CLI's diagnostics would list them. */
export async function indexMarketplace(repo: string, fetcher: Fetcher): Promise<IndexedPlugin[]> {
	let catalog: MarketplaceFile | undefined;
	for (const path of CATALOG_PATHS) {
		catalog = await getJson<MarketplaceFile>(fetcher, raw(repo, path));
		if (catalog?.plugins) break;
	}
	const out: IndexedPlugin[] = [];
	for (const plugin of (catalog?.plugins ?? []).slice(0, MAX_PLUGINS)) {
		if (typeof plugin.name !== "string" || !NAME.test(plugin.name)) continue;
		// Only plugins inside the marketplace repository: a git source elsewhere would need a clone.
		const base = typeof plugin.source === "string" ? safePath(plugin.source) : undefined;
		if (!base) continue;
		const manifest = (await getJson<PluginFile>(fetcher, raw(repo, `${base}/.claude-plugin/plugin.json`))) ?? {};
		const mcp = (await getJson<McpFile>(fetcher, raw(repo, `${base}/.mcp.json`))) ?? {};
		const servers: IndexedPlugin["servers"] = [];
		const inert: string[] = [];
		for (const [name, server] of Object.entries(mcp.mcpServers ?? {})) {
			if (server.url && /^https:\/\//i.test(server.url) && (server.type === "http" || server.type === "sse" || !server.type))
				servers.push({ name, url: server.url });
			else if (server.command) inert.push(`local MCP server ${name}`);
		}
		if (manifest.hooks) inert.push("hooks");
		if (manifest.commands) inert.push("commands");
		const description = typeof plugin.description === "string" ? plugin.description : (manifest.description ?? "");
		out.push({
			entry: {
				id: plugin.name.toLowerCase(),
				name: plugin.name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
				maker: typeof plugin.author?.name === "string" ? plugin.author.name : plugin.name,
				category: "developer",
				icon: "",
				description: description.slice(0, 300),
				auth: "oauth",
				skills: [],
				permissions: DEFAULT_PERMISSIONS,
			},
			servers,
			skills: [],
			inert,
		});
	}
	return out;
}

/**
 * The scheduled job: indexes every marketplace and stores the result (D1 for the catalog, R2 for skill files as they
 * are fetched). A marketplace that fails keeps its previous index.
 */
export async function indexPlugins(env: { DB: D1Database }, fetcher: Fetcher = (url) => fetch(url)): Promise<number> {
	let stored = 0;
	for (const marketplace of MARKETPLACES) {
		let plugins: IndexedPlugin[];
		try {
			plugins = await indexMarketplace(marketplace.repo, fetcher);
		} catch {
			continue;
		}
		if (plugins.length === 0) continue;
		const statements = [
			env.DB.prepare("DELETE FROM plugin_catalog WHERE marketplace = ?").bind(marketplace.name),
			...plugins.map((plugin) =>
				env.DB.prepare(
					"INSERT OR REPLACE INTO plugin_catalog (id, marketplace, entry, servers, skills, inert, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				).bind(
					plugin.entry.id,
					marketplace.name,
					JSON.stringify(plugin.entry),
					JSON.stringify(plugin.servers),
					JSON.stringify(plugin.skills),
					JSON.stringify(plugin.inert),
					Date.now(),
				),
			),
		];
		await env.DB.batch(statements);
		stored += plugins.length;
	}
	return stored;
}

/** The indexed plugins that offer a remote server, as a catalog source's entries. */
export async function pluginEntries(db: D1Database): Promise<CatalogEntry[]> {
	const rows = await db.prepare("SELECT entry, servers FROM plugin_catalog").all<{ entry: string; servers: string }>();
	return rows.results.filter((row) => (JSON.parse(row.servers) as unknown[]).length > 0).map((row) => JSON.parse(row.entry) as CatalogEntry);
}
