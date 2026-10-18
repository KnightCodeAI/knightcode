/**
 * The sidebar (desktop-shell.md section 9.2), laid out like Codex's: product name and search,
 * New thread, then Pinned, Needs attention, Projects and Recents; settings and the archive in
 * the footer.
 */

import type { ThreadSummary } from "@knightcode/app-server-protocol";
import {
	Archive,
	ChevronRight,
	Folder,
	FolderPlus,
	GitBranchPlus,
	Pin,
	PinOff,
	Search,
	SquarePen,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { matches } from "../keys.ts";
import { basename, relativeTime, samePath } from "../format.ts";
import {
	addProject,
	archive,
	navigate,
	openThread,
	pinThread,
	selectProjects,
	showNew,
	updateDesktop,
	useStore,
} from "../store.ts";

const NO_PINS: string[] = [];

function StatusMark({ thread }: { thread: ThreadSummary }) {
	const { status } = thread;
	if (status.type === "active" && status.waitingOn.length > 0)
		return <span title="Waiting on you" className="size-2 shrink-0 rounded-full bg-warning" />;
	if (status.type === "active")
		return (
			<span
				title="Working"
				className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-muted border-t-transparent"
			/>
		);
	if (status.type === "systemError")
		return <span title={status.message} className="size-2 shrink-0 rounded-full bg-danger" />;
	return null;
}

function ThreadRow({ thread, selected, pinned }: { thread: ThreadSummary; selected: boolean; pinned: boolean }) {
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => void openThread(thread.id)}
			onKeyDown={(e) => {
				// Enter on the nested Pin or Archive button bubbles here; that button's click handles it.
				if (e.target !== e.currentTarget || !matches(e, "desktop.item.activate")) return;
				e.preventDefault();
				void openThread(thread.id);
			}}
			title={`${thread.name || "Untitled"}\n${thread.cwd}`}
			className={`group flex h-[34px] cursor-default items-center gap-2 rounded-lg pr-1.5 pl-2.5 ${selected ? "bg-selected text-ink" : "text-ink/90 hover:bg-hover"}`}
		>
			<span className="min-w-0 flex-1 truncate">{thread.name || "Untitled"}</span>
			<StatusMark thread={thread} />
			{thread.workspaceMode === "worktree" ? (
				<GitBranchPlus size={13} aria-label="Worktree" className="shrink-0 text-faint group-hover:hidden" />
			) : null}
			<span className="shrink-0 text-[12px] text-faint group-hover:hidden">{relativeTime(thread.updatedAt)}</span>
			<span className="hidden shrink-0 items-center group-hover:flex">
				<button
					type="button"
					title={pinned ? "Unpin" : "Pin"}
					onClick={(e) => {
						e.stopPropagation();
						pinThread(thread.id, !pinned);
					}}
					className="rounded p-1 text-faint hover:text-ink"
				>
					{pinned ? <PinOff size={13} /> : <Pin size={13} />}
				</button>
				<button
					type="button"
					title="Archive"
					onClick={(e) => {
						e.stopPropagation();
						void archive(thread.id);
					}}
					className="rounded p-1 text-faint hover:text-ink"
				>
					<Archive size={13} />
				</button>
			</span>
		</div>
	);
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
	return (
		<section className="mb-4">
			<div className="flex h-8 items-center justify-between px-2.5">
				<span className="text-[13px] font-medium text-muted">{title}</span>
				{action}
			</div>
			{children}
		</section>
	);
}

function ProjectGroup({
	path,
	name,
	threads,
	selectedId,
	pins,
}: {
	path: string;
	name?: string;
	threads: ThreadSummary[];
	selectedId?: string;
	pins: string[];
}) {
	const [collapsed, setCollapsed] = useState(false);
	const [all, setAll] = useState(false);
	const shown = all ? threads : threads.slice(0, 10);
	return (
		<div className="mb-1">
			<div className="group flex h-[34px] items-center gap-1.5 rounded-lg px-1.5 hover:bg-hover" title={path}>
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
				>
					<ChevronRight size={13} className={`shrink-0 text-faint transition ${collapsed ? "" : "rotate-90"}`} />
					<Folder size={15} className="shrink-0 text-muted" />
					<span className="truncate">{name ?? basename(path)}</span>
				</button>
				<button
					type="button"
					title="New thread here"
					onClick={() => showNew(path)}
					className="hidden rounded p-1 text-faint group-hover:block hover:text-ink"
				>
					<SquarePen size={13} />
				</button>
				<button
					type="button"
					title="Remove from sidebar (threads stay on disk)"
					onClick={() => updateDesktop((d) => ({ ...d, projects: d.projects.filter((p) => p.path !== path) }))}
					className="hidden rounded p-1 text-faint group-hover:block hover:text-ink"
				>
					<X size={13} />
				</button>
			</div>
			{collapsed ? null : (
				<div className="ml-3.5">
					{threads.length === 0 ? <div className="py-1 pl-2.5 text-[13px] text-faint">No threads yet</div> : null}
					{shown.map((t) => (
						<ThreadRow key={t.id} thread={t} selected={t.id === selectedId} pinned={pins.includes(t.id)} />
					))}
					{threads.length > 10 && !all ? (
						<button
							type="button"
							onClick={() => setAll(true)}
							className="py-1 pl-2.5 text-[13px] text-faint hover:text-muted"
						>
							Show {threads.length - 10} more
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}

export function Sidebar() {
	const threads = useStore((s) => s.threads);
	const projects = useStore(selectProjects);
	const pins = useStore((s) => s.desktop?.pinnedThreads ?? NO_PINS);
	const view = useStore((s) => s.view);
	const [searching, setSearching] = useState(false);
	const [query, setQuery] = useState("");
	const selectedId = view.kind === "thread" ? view.id : undefined;
	const q = query.trim().toLowerCase();
	const visible = q ? threads.filter((t) => t.name.toLowerCase().includes(q)) : threads;
	const pinned = pins.map((id) => visible.find((t) => t.id === id)).filter((t): t is ThreadSummary => t !== undefined);
	const attention = visible.filter(
		(t) => (t.status.type === "active" && t.status.waitingOn.length > 0) || t.status.type === "systemError",
	);
	const inProject = (t: ThreadSummary) => projects.some((p) => samePath(p.path, t.projectCwd));
	const recent = visible.filter((t) => !inProject(t) && !pins.includes(t.id)).slice(0, 40);

	return (
		<aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-sidebar">
			<div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
				<span className="text-[17px] font-semibold tracking-tight">KnightCode</span>
				<button
					type="button"
					title="Search threads"
					onClick={() => {
						setSearching(!searching);
						setQuery("");
					}}
					className={`rounded-md p-1.5 ${searching ? "bg-hover text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
				>
					<Search size={16} />
				</button>
			</div>
			<div className="px-2">
				{searching ? (
					<input
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (!matches(e, "desktop.picker.dismiss")) return;
							e.preventDefault();
							setSearching(false);
							setQuery("");
						}}
						placeholder="Search threads"
						className="mb-1 h-[34px] w-full rounded-lg border border-line bg-surface px-2.5 outline-none focus:border-line-strong"
					/>
				) : null}
				<button
					type="button"
					onClick={() => showNew()}
					className={`flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 ${view.kind === "new" ? "bg-selected" : "hover:bg-hover"}`}
				>
					<SquarePen size={16} className="text-muted" /> New thread
				</button>
			</div>
			<div className="mx-4 my-2 border-t border-line" />
			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
				{pinned.length > 0 ? (
					<Section title="Pinned">
						{pinned.map((t) => (
							<ThreadRow key={t.id} thread={t} selected={t.id === selectedId} pinned />
						))}
					</Section>
				) : null}
				{attention.length > 0 ? (
					<Section title="Needs attention">
						{attention.map((t) => (
							<ThreadRow key={t.id} thread={t} selected={t.id === selectedId} pinned={pins.includes(t.id)} />
						))}
					</Section>
				) : null}
				<Section
					title="Projects"
					action={
						<button
							type="button"
							title="Add a project folder"
							onClick={() => void addProject()}
							className="rounded p-1 text-faint hover:text-ink"
						>
							<FolderPlus size={14} />
						</button>
					}
				>
					{projects.length === 0 ? (
						<button
							type="button"
							onClick={() => void addProject()}
							className="w-full rounded-lg px-2.5 py-1.5 text-left text-faint hover:bg-hover"
						>
							No projects
						</button>
					) : null}
					{projects.map((p) => (
						<ProjectGroup
							key={p.path}
							path={p.path}
							name={p.name}
							threads={visible.filter((t) => samePath(p.path, t.projectCwd) && !pins.includes(t.id))}
							selectedId={selectedId}
							pins={pins}
						/>
					))}
				</Section>
				{recent.length > 0 ? (
					<Section title="Recents">
						{recent.map((t) => (
							<ThreadRow key={t.id} thread={t} selected={t.id === selectedId} pinned={false} />
						))}
					</Section>
				) : null}
			</div>
		</aside>
	);
}
