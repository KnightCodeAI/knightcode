// The connector catalog (spec section 9): one list of apps from three sources, the curated official MCP servers first,
// then indexed plugins, then Composio. An app appears once, from the first source that has it, and the user never
// sees which source that was; how it connects is the server's business.
import APP_SKILLS from "./app-skills.json";
import type { CatalogEntry } from "@knightcode/bots-protocol";
import curated from "./curated.json";
import { DEFAULT_PERMISSIONS } from "./permissions.ts";

/** A curated official server: catalog fields plus where and how to connect. */
export interface CuratedServer {
	id: string;
	name: string;
	maker: string;
	category: CatalogEntry["category"];
	icon: string;
	description: string;
	url: string;
	auth: CatalogEntry["auth"];
	usageNote?: string;
}

export const CURATED: CuratedServer[] = curated as CuratedServer[];

/** The skills KnightCode writes for the most used apps that have none of their own. */
export const appSkills = (appId: string): CatalogEntry["skills"] => (APP_SKILLS as Record<string, CatalogEntry["skills"]>)[appId] ?? [];

export const curatedEntries = (): CatalogEntry[] =>
	CURATED.map(({ url: _url, ...entry }) => ({ ...entry, skills: [], permissions: DEFAULT_PERMISSIONS }));

/** Where an entry came from and how to connect it; kept server-side, never in the catalog the client gets. */
export type CatalogSource =
	| { kind: "curated"; entries: CatalogEntry[] }
	| { kind: "plugins"; entries: CatalogEntry[] }
	| { kind: "composio"; entries: CatalogEntry[] };

const ORDER: Record<CatalogSource["kind"], number> = { curated: 0, plugins: 1, composio: 2 };

/** The app's identity across sources: lowercase id with separators removed ("google-drive" = "googledrive"). */
export const appKey = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, "");

/** One entry per app, curated before plugins before Composio, sorted by name. */
export function mergeCatalog(sources: CatalogSource[]): CatalogEntry[] {
	const chosen = new Map<string, CatalogEntry>();
	for (const source of [...sources].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]))
		for (const entry of source.entries) {
			const key = appKey(entry.id);
			if (chosen.has(key)) continue;
			// A fresh object of the schema's fields only, so nothing source-specific leaks through.
			const { id, name, maker, category, icon, description, auth, skills, usageNote, permissions, notice, connection } = entry;
			chosen.set(key, {
				id,
				name,
				maker,
				category,
				icon,
				description,
				auth,
				skills,
				permissions,
				...(usageNote === undefined ? {} : { usageNote: usageNote.slice(0, 500) }),
				...(notice === undefined ? {} : { notice }),
				...(connection === undefined ? {} : { connection }),
			});
		}
	return [...chosen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Which source serves an app, for the server's connect path. */
export function sourceOf(sources: CatalogSource[], appId: string): CatalogSource["kind"] | undefined {
	const key = appKey(appId);
	return [...sources].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).find((source) => source.entries.some((entry) => appKey(entry.id) === key))
		?.kind;
}
