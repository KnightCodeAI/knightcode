/**
 * The sidebar's sections and their threads (desktop-shell.md section 9.2), worked out apart from the component so
 * the go-to-thread shortcuts and the command palette number threads exactly as the sidebar shows them (Codex's
 * "Go to chat N": the visible chat in that slot), and the other thread shortcuts step through the same order.
 */

import type { ThreadSummary } from "@knightcode/app-server-protocol";

/** Threads a project shows before "Show more". */
export const PROJECT_PAGE = 10;

/** Threads Recents shows. */
const RECENT_LIMIT = 40;

interface Project {
	path: string;
	name?: string;
	collapsed: boolean;
}

/** Codex's sidebar options menu: Organize sidebar (by project or in one list) and Sort chats by. */
export interface SidebarOptions {
	organize: "project" | "list";
	sort: "updated" | "created";
}

export const DEFAULT_SIDEBAR_OPTIONS: SidebarOptions = { organize: "project", sort: "updated" };

export interface SidebarModel {
	pinned: ThreadSummary[];
	attention: ThreadSummary[];
	projects: (Project & { threads: ThreadSummary[] })[];
	recent: ThreadSummary[];
}

const waiting = (t: ThreadSummary) =>
	(t.status.type === "active" && t.status.waitingOn.length > 0) || t.status.type === "systemError";

/** Newest first by the chosen time; ISO timestamps compare as strings. */
const byTime = (sort: SidebarOptions["sort"]) => (a: ThreadSummary, b: ThreadSummary) =>
	sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt);

/**
 * Pinned threads in pin order; those waiting on the user or failed; each project's unpinned threads; then the rest
 * (all unpinned threads, organized in one list), newest first. A query keeps only threads whose title contains it.
 * `samePath` compares a project folder with a thread's (case-insensitively on Windows).
 */
export function sidebarModel(
	threads: ThreadSummary[],
	projects: Project[],
	pins: string[],
	query: string,
	samePath: (a: string, b: string) => boolean,
	options: SidebarOptions = DEFAULT_SIDEBAR_OPTIONS,
): SidebarModel {
	const q = query.trim().toLowerCase();
	const visible = (q ? threads.filter((t) => t.name.toLowerCase().includes(q)) : threads).toSorted(
		byTime(options.sort),
	);
	const unpinned = visible.filter((t) => !pins.includes(t.id));
	const inProject = (t: ThreadSummary) => projects.some((p) => samePath(p.path, t.projectCwd));
	const list = options.organize === "list";
	return {
		pinned: pins.map((id) => visible.find((t) => t.id === id)).filter((t): t is ThreadSummary => t !== undefined),
		attention: visible.filter(waiting),
		projects: list
			? []
			: projects.map((p) => ({ ...p, threads: unpinned.filter((t) => samePath(p.path, t.projectCwd)) })),
		recent: list ? unpinned : unpinned.filter((t) => !inProject(t)).slice(0, RECENT_LIMIT),
	};
}

/**
 * The threads the go-to-thread shortcuts reach, in the order the sidebar shows them: what open sections and expanded
 * projects list (a project's first page), each thread once.
 */
export function threadSlots(model: SidebarModel, foldedSections: string[]): ThreadSummary[] {
	const open = (id: string) => !foldedSections.includes(id);
	const order = [
		...(open("pinned") ? model.pinned : []),
		...(open("attention") ? model.attention : []),
		...(open("projects") ? model.projects.flatMap((p) => (p.collapsed ? [] : p.threads.slice(0, PROJECT_PAGE))) : []),
		...(open("recents") ? model.recent : []),
	];
	return order.filter((t, i) => order.findIndex((u) => u.id === t.id) === i);
}

/** Codex's "Go to recent chat N": the most recently updated threads, whatever the sidebar shows. */
export const recentThreads = (threads: ThreadSummary[], count: number): ThreadSummary[] =>
	threads.toSorted(byTime("updated")).slice(0, count);

/**
 * The thread after `current` among those needing attention (waiting on the user, failed, or unread), in sidebar order,
 * wrapping round; the first of them when `current` is not one.
 */
export function nextNeedingAttention(
	slots: ThreadSummary[],
	threads: ThreadSummary[],
	unread: string[],
	current: string | undefined,
): ThreadSummary | undefined {
	const order = [...slots, ...threads.toSorted(byTime("updated")).filter((t) => !slots.includes(t))];
	const needing = order.filter((t) => waiting(t) || unread.includes(t.id));
	const at = needing.findIndex((t) => t.id === current);
	return needing[(at + 1) % needing.length];
}

/** The thread `delta` places from `current` in the sidebar's order, wrapping round; the first when none is open. */
export function stepThread(
	slots: ThreadSummary[],
	current: string | undefined,
	delta: 1 | -1,
): ThreadSummary | undefined {
	const at = slots.findIndex((t) => t.id === current);
	if (at === -1) return delta === 1 ? slots[0] : slots.at(-1);
	return slots[(at + delta + slots.length) % slots.length];
}

export interface RowSelection {
	ids: string[];
	/** The row a range starts from: the last one toggled. */
	anchor?: string;
}

/**
 * The sidebar's selection after a modifier click (Codex's multi-select archive): `toggle` (Ctrl, or Cmd on macOS)
 * adds or drops the row; `range` (Shift) selects the rows from the anchor to this one in sidebar `order`.
 */
export function selectRows(
	selection: RowSelection,
	order: string[],
	id: string,
	mode: "toggle" | "range",
): RowSelection {
	if (mode === "toggle")
		return {
			ids: selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id],
			anchor: id,
		};
	const anchor = selection.anchor ?? id;
	const [from, to] = [order.indexOf(anchor), order.indexOf(id)];
	if (from === -1 || to === -1) return { ids: [id], anchor: id };
	return { ids: order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor };
}
