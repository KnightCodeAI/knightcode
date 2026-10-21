/**
 * Settings › Archived threads' search, filters and order, after Codex's Archived chats (2026-10-19): a kind (Codex's
 * Local and Cloud are KnightCode's local and worktree threads), an order (updated, created, alphabetical) and a
 * project, or no project (Codex's "Chats"). The page groups what is left by project. Also which threads Settings ›
 * General's auto-archive takes.
 */

import type { ThreadSummary } from "@knightcode/app-server-protocol";

export type ArchiveKind = "all" | "local" | "worktree";
export type ArchiveSort = "updated" | "created" | "name";
/** A project's folder, every project, or threads outside any project. */
export type ArchiveProject = "all" | "none" | (string & {});

export interface ArchiveFilter {
	query: string;
	kind: ArchiveKind;
	sort: ArchiveSort;
	project: ArchiveProject;
}

export const NO_PROJECT = "No project";

/** The archived threads a filter keeps, in its order, grouped under their project's name (or NO_PROJECT). */
export function filterArchived(
	threads: ThreadSummary[],
	filter: ArchiveFilter,
	projects: { path: string; name?: string }[],
	samePath: (a: string, b: string) => boolean,
	basename: (path: string) => string,
): [group: string, threads: ThreadSummary[]][] {
	const q = filter.query.trim().toLowerCase();
	const projectOf = (t: ThreadSummary) => projects.find((p) => samePath(p.path, t.projectCwd));
	const kept = threads.filter((t) => {
		if (q && !t.name.toLowerCase().includes(q)) return false;
		if (filter.kind !== "all" && t.workspaceMode !== filter.kind) return false;
		if (filter.project === "none") return !projectOf(t);
		if (filter.project !== "all") return samePath(filter.project, t.projectCwd);
		return true;
	});
	const order: Record<ArchiveSort, (a: ThreadSummary, b: ThreadSummary) => number> = {
		updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
		created: (a, b) => b.createdAt.localeCompare(a.createdAt),
		name: (a, b) => a.name.localeCompare(b.name),
	};
	const groups = new Map<string, ThreadSummary[]>();
	for (const t of kept.toSorted(order[filter.sort])) {
		const project = projectOf(t);
		const name = project ? (project.name ?? basename(project.path)) : NO_PROJECT;
		groups.set(name, [...(groups.get(name) ?? []), t]);
	}
	return [...groups];
}

/**
 * Codex's "Automatically archive inactive chats": the threads idle (not running, waiting or failed) since before
 * `days` ago, except those to keep (pinned, the one on screen).
 */
export function inactiveThreads(threads: ThreadSummary[], days: number, now: number, keep: string[]): ThreadSummary[] {
	const cutoff = now - days * 86_400_000;
	return threads.filter(
		(t) =>
			(t.status.type === "idle" || t.status.type === "notLoaded") &&
			Date.parse(t.updatedAt) < cutoff &&
			!keep.includes(t.id),
	);
}
