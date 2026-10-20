/**
 * Views as `knightcode://` links (desktop-shell.md section 6.1): Codex's "Copy deeplink" makes one for a thread, and
 * main hands the page any link the system opened the app with.
 */

import type { View } from "./store.ts";

export const SETTINGS_PAGE_IDS = [
	"general",
	"appearance",
	"models",
	"shortcuts",
	"archived",
	"configuration",
	"tools",
	"mcp",
	"extensions",
	"worktrees",
	"about",
] as const;
export type SettingsPage = (typeof SETTINGS_PAGE_IDS)[number];

export const threadLink = (id: string) => `knightcode://thread/${encodeURIComponent(id)}`;

/** The view a link names: `thread/<id>`, `new?cwd=<path>`, `settings/<page>`; undefined for anything else. */
export function viewOfLink(link: string): View | undefined {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return undefined;
	}
	if (url.protocol !== "knightcode:") return undefined;
	// In `knightcode://thread/x` the first segment parses as the host.
	const [first = "", ...rest] = [url.host, ...url.pathname.split("/").filter(Boolean)].map(decodeURIComponent);
	if (first === "thread" && rest[0]) return { kind: "thread", id: rest[0] };
	if (first === "new") {
		const cwd = url.searchParams.get("cwd");
		return cwd ? { kind: "new", cwd } : { kind: "new" };
	}
	if (first === "settings") {
		const page = SETTINGS_PAGE_IDS.find((p) => p === (rest[0] ?? "general"));
		return page ? { kind: "settings", page } : undefined;
	}
	return undefined;
}
