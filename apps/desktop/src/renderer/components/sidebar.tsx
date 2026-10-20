/**
 * The sidebar (desktop-shell.md section 9.2), laid out as Codex's (measured 2026-10-19): the product name and search
 * over New thread, then Pinned, Needs attention, Projects and Recents. Every row is a NavRow (30px); sections fold
 * from their headers, whose buttons show on hover: the sidebar options (organize by project or in one list, sort by
 * activity or creation), Add project and New thread. Projects fold too and carry a … menu and a New thread button;
 * threads show Pin and Archive on hover, a native context menu on right-click, and a card with their details after a
 * rest of the pointer. Ctrl-click (Cmd on macOS) and Shift-click select several threads to archive together. The
 * panel is resizable from its right edge, and its width, folds, options and visibility are remembered (desktop state).
 */

import type { ThreadSummary } from "@knightcode/app-server-protocol";
import type React from "react";
import { type ReactNode, useState } from "react";
import { SIDEBAR_WIDTH } from "../../shared/host-protocol.ts";
import { client } from "../client.ts";
import { basename, messageTime, samePath } from "../format.ts";
import { isMac, matches } from "../keys.ts";
import {
	addProject,
	archive,
	archiveThreads,
	openThread,
	pinThread,
	removeProject,
	selectProjects,
	selectUnread,
	setSidebarOpen,
	setSidebarOption,
	setSidebarWidth,
	showNew,
	sidebarOptionsOf,
	toggleProject,
	toggleSection,
	useStore,
} from "../store.ts";
import { PROJECT_PAGE, type RowSelection, selectRows, sidebarModel, threadSlots } from "../sidebar-model.ts";
import { IconButton } from "./button.tsx";
import { type ContextMenuItem, contextMenu } from "./context-menu.ts";
import { ConfirmDialog } from "./dialog.tsx";
import {
	Archive,
	ArrowDownUp,
	ChevronRight,
	CircleAlert,
	Folder,
	FolderOpen,
	FolderPlus,
	GitBranchPlus,
	List,
	MoreHorizontal,
	PanelLeft,
	Pin,
	PinOff,
	Search,
	SquarePen,
} from "./icons.tsx";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuTrigger,
} from "./menu.tsx";
import { NavRow } from "./nav-row.tsx";
import { HoverCard } from "./popover.tsx";
import { Tooltip } from "./tooltip.tsx";
import { DeleteThreadDialog, RenameThreadDialog, type ThreadActionItem, threadActions } from "./thread-actions.tsx";

const NO_PINS: string[] = [];
const NO_SECTIONS: string[] = [];
const NO_SELECTION: RowSelection = { ids: [] };

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** A thread's actions as a native context menu (Codex's right-click menu on a sidebar row). */
const nativeItems = (items: ThreadActionItem[]): ContextMenuItem[] =>
	items.map((item) => (item !== "-" && "items" in item ? { label: item.label, items: item.items } : item));

/** The dialogs the sidebar opens; one at a time. */
type SidebarDialog =
	| { kind: "rename"; threadId: string }
	| { kind: "delete"; thread: ThreadSummary }
	| { kind: "remove"; path: string }
	| { kind: "archive"; threads: ThreadSummary[]; project?: string };

function StatusMark({ thread, unread }: { thread: ThreadSummary; unread: boolean }) {
	const { status } = thread;
	if (status.type === "active" && status.waitingOn.length > 0)
		return (
			<Tooltip content="Waiting on you">
				<span className="size-2 shrink-0 rounded-full bg-warning" />
			</Tooltip>
		);
	if (status.type === "active")
		return (
			<Tooltip content="Working">
				<span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-secondary border-t-transparent" />
			</Tooltip>
		);
	if (status.type === "systemError")
		return (
			<Tooltip content={status.message}>
				<span className="size-2 shrink-0 rounded-full bg-danger" />
			</Tooltip>
		);
	// Codex's unread dot: 8px, its blue.
	if (unread)
		return (
			<Tooltip content="Unread">
				<span className="size-2 shrink-0 rounded-full bg-[var(--kc-focus)]" />
			</Tooltip>
		);
	if (thread.workspaceMode === "worktree")
		return <GitBranchPlus size={14} aria-label="Worktree" className="text-tertiary" />;
	return null;
}

/** A line of a hover card: a 16px icon slot and its text. */
function CardRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className="flex size-4 shrink-0 items-center justify-center text-tertiary">{icon}</span>
			<span className="min-w-0 truncate">{children}</span>
		</div>
	);
}

/** Codex's thread hover card: the whole title and when it last changed, then its project, worktree and state. */
function ThreadCard({ thread }: { thread: ThreadSummary }) {
	const { status } = thread;
	const state =
		status.type === "systemError"
			? status.message
			: status.type === "active"
				? status.waitingOn.length > 0
					? "Waiting on you"
					: "Working"
				: undefined;
	return (
		<>
			<div className="flex items-baseline gap-3">
				<span className="min-w-0 flex-1 text-base font-medium [overflow-wrap:anywhere] text-ink">
					{thread.name || "Untitled"}
				</span>
				<time className="shrink-0 text-xs text-tertiary" dateTime={thread.updatedAt}>
					{messageTime(Date.parse(thread.updatedAt))}
				</time>
			</div>
			<CardRow icon={<Folder size={14} />}>{basename(thread.projectCwd)}</CardRow>
			{thread.workspaceMode === "worktree" ? (
				<CardRow icon={<GitBranchPlus size={14} />}>Worktree · {basename(thread.cwd)}</CardRow>
			) : null}
			{state ? <CardRow icon={<CircleAlert size={14} />}>{state}</CardRow> : null}
		</>
	);
}

/** Codex's project hover card: the name, the folder, and how many threads it has and how many are running. */
function ProjectCard({ name, path, threads }: { name: string; path: string; threads: ThreadSummary[] }) {
	const active = threads.filter((t) => t.status.type === "active").length;
	return (
		<>
			<span className="text-base font-medium [overflow-wrap:anywhere] text-ink">{name}</span>
			<span className="text-xs [overflow-wrap:anywhere] text-tertiary">{path}</span>
			<span>
				{plural(threads.length, "thread")}
				{active ? ` · ${active} active` : ""}
			</span>
		</>
	);
}

function ThreadRow({
	thread,
	current,
	picked,
	pinned,
	inset,
	selectionSize,
	onActivate,
	onArchive,
	onDialog,
	onClearSelection,
}: {
	thread: ThreadSummary;
	current: boolean;
	/** In the multi-row selection. */
	picked: boolean;
	pinned: boolean;
	inset?: boolean;
	selectionSize: number;
	onActivate: (thread: ThreadSummary, event: React.MouseEvent | React.KeyboardEvent) => void;
	onArchive: (thread: ThreadSummary) => void;
	onDialog: (dialog: SidebarDialog) => void;
	onClearSelection: () => void;
}) {
	const unread = useStore((s) => selectUnread(s).includes(thread.id));
	const items = (): ContextMenuItem[] =>
		picked && selectionSize > 1
			? [
					{ label: `Archive ${plural(selectionSize, "thread")}`, run: () => onArchive(thread) },
					"-",
					{ label: "Clear selection", run: onClearSelection },
				]
			: nativeItems(
					threadActions(thread, {
						pinned,
						unread,
						open: current,
						onRename: () => onDialog({ kind: "rename", threadId: thread.id }),
						onDelete: () => onDialog({ kind: "delete", thread }),
					}),
				);
	return (
		<HoverCard content={<ThreadCard thread={thread} />}>
			<NavRow
				inset={inset}
				label={thread.name || "Untitled"}
				current={current}
				selected={picked}
				onActivate={(event) => onActivate(thread, event)}
				onContextMenu={contextMenu(items)}
				status={<StatusMark thread={thread} unread={unread} />}
				actions={
					<>
						<IconButton
							label={pinned ? "Unpin thread" : "Pin thread"}
							size="3xs"
							round
							onClick={() => pinThread(thread.id, !pinned)}
						>
							{pinned ? <PinOff size={14} /> : <Pin size={14} />}
						</IconButton>
						<IconButton
							label={picked && selectionSize > 1 ? `Archive ${plural(selectionSize, "thread")}` : "Archive thread"}
							size="3xs"
							round
							onClick={() => onArchive(thread)}
						>
							<Archive size={14} />
						</IconButton>
					</>
				}
			/>
		</HoverCard>
	);
}

/** A section with a header that folds it (Codex's): its title, a chevron on hover, and its buttons on hover. */
function Section({
	id,
	title,
	actions,
	children,
}: {
	id: string;
	title: string;
	actions?: ReactNode;
	children: ReactNode;
}) {
	const folded = useStore((s) => (s.desktop?.sidebar.collapsedSections ?? NO_SECTIONS).includes(id));
	return (
		<section className="group/section px-2">
			<div className="flex h-[30px] items-center gap-2 ps-2 pe-1.5">
				<button
					type="button"
					aria-expanded={!folded}
					onClick={() => toggleSection(id)}
					className="-ms-1 flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-base font-medium text-tertiary"
				>
					<span className="truncate">{title}</span>
					<ChevronRight
						size={14}
						className={`shrink-0 opacity-0 transition-[opacity,rotate] group-hover/section:opacity-100 motion-reduce:transition-none ${folded ? "" : "rotate-90"}`}
					/>
				</button>
				{actions ? (
					// Kept shown while a menu they opened is open.
					<div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
						{actions}
					</div>
				) : null}
			</div>
			{folded ? null : <div className="flex flex-col gap-px pt-1">{children}</div>}
		</section>
	);
}

/** Codex's sidebar options (the … on the Projects and Recents headings): Organize sidebar › and Sort threads by ›. */
function SidebarOptionsMenu({ label }: { label: string }) {
	const organize = useStore((s) => sidebarOptionsOf(s).organize);
	const sort = useStore((s) => sidebarOptionsOf(s).sort);
	return (
		<Menu>
			<MenuTrigger>
				<IconButton label={label} size="xs">
					<MoreHorizontal size={16} />
				</IconButton>
			</MenuTrigger>
			<MenuContent>
				<MenuSub label="Organize sidebar" icon={<PanelLeft />} minWidth={180}>
					<MenuRadioGroup
						value={organize}
						onValueChange={(value) => setSidebarOption("organize", value === "list" ? "list" : "project")}
					>
						<MenuRadioItem value="project" icon={<Folder />}>
							By project
						</MenuRadioItem>
						<MenuRadioItem value="list" icon={<List />}>
							In one list
						</MenuRadioItem>
					</MenuRadioGroup>
				</MenuSub>
				<MenuSub label="Sort threads by" icon={<ArrowDownUp />} minWidth={180}>
					<MenuRadioGroup
						value={sort}
						onValueChange={(value) => setSidebarOption("sort", value === "created" ? "created" : "updated")}
					>
						<MenuRadioItem value="updated">Last updated</MenuRadioItem>
						<MenuRadioItem value="created">Created</MenuRadioItem>
					</MenuRadioGroup>
				</MenuSub>
			</MenuContent>
		</Menu>
	);
}

/** Codex's "Archive chats" confirmation, for a project's threads or a selection; it says so when some are running. */
function ArchiveThreadsDialog({
	threads,
	project,
	onDone,
	onClose,
}: {
	threads: ThreadSummary[];
	project?: string;
	onDone: () => void;
	onClose: () => void;
}) {
	const running = threads.some((t) => t.status.type === "active");
	const which = threads.length === 1 ? "the thread" : "the threads";
	return (
		<ConfirmDialog
			title={`${running ? "Stop and archive" : "Archive"} ${plural(threads.length, "thread")}?`}
			description={
				running
					? `Archiving will stop any ongoing work. You can restore ${which} later in Settings.`
					: `This will archive ${project ? `the threads in ${project}` : "the selected threads"}. You can find them later in Archived threads.`
			}
			confirm={running ? "Stop and archive" : project ? "Archive all" : "Archive"}
			onConfirm={() =>
				void archiveThreads(
					threads.map((t) => t.id),
					project,
				).then(onDone)
			}
			onClose={onClose}
		/>
	);
}

function ProjectGroup({
	path,
	name,
	collapsed,
	current,
	threads,
	row,
	onDialog,
}: {
	path: string;
	name?: string;
	collapsed: boolean;
	current: boolean;
	threads: ThreadSummary[];
	row: (thread: ThreadSummary, inset?: boolean) => ReactNode;
	onDialog: (dialog: SidebarDialog) => void;
}) {
	const [all, setAll] = useState(false);
	const shown = all ? threads : threads.slice(0, PROJECT_PAGE);
	const label = name ?? basename(path);
	const showInFolder = () => void client.host("host/shell/showInFolder", { path });
	const archiveAll = () => onDialog({ kind: "archive", threads, project: label });
	const project: ContextMenuItem[] = [
		{ label: "New thread", run: () => showNew(path) },
		{ label: "Show in folder", run: showInFolder },
		"-",
		{ label: "Archive threads", run: archiveAll, disabled: threads.length === 0 },
		{ label: "Remove project", run: () => onDialog({ kind: "remove", path }) },
	];
	return (
		<div>
			<HoverCard content={<ProjectCard name={label} path={path} threads={threads} />}>
				<NavRow
					icon={collapsed ? <Folder size={16} /> : <FolderOpen size={16} />}
					label={label}
					expanded={!collapsed}
					current={current}
					onActivate={() => toggleProject(path)}
					onContextMenu={contextMenu(() => project)}
					actions={
						<>
							<Menu>
								<MenuTrigger>
									<IconButton label={`Project actions for ${label}`} size="3xs" round>
										<MoreHorizontal size={14} />
									</IconButton>
								</MenuTrigger>
								<MenuContent align="start">
									<MenuItem icon={<SquarePen />} onSelect={() => showNew(path)}>
										New thread
									</MenuItem>
									<MenuItem icon={<FolderOpen />} onSelect={showInFolder}>
										Show in folder
									</MenuItem>
									<MenuSeparator />
									<MenuItem icon={<Archive />} disabled={threads.length === 0} onSelect={archiveAll}>
										Archive threads
									</MenuItem>
									<MenuItem onSelect={() => onDialog({ kind: "remove", path })}>Remove project</MenuItem>
								</MenuContent>
							</Menu>
							<IconButton label={`Start new thread in ${label}`} size="3xs" round onClick={() => showNew(path)}>
								<SquarePen size={14} />
							</IconButton>
						</>
					}
				/>
			</HoverCard>
			{collapsed ? null : (
				<div className="flex flex-col gap-px pt-px">
					{threads.length === 0 ? <div className="ps-8 text-sm leading-[30px] text-tertiary">No threads</div> : null}
					{shown.map((t) => row(t, true))}
					{threads.length > PROJECT_PAGE ? (
						<button type="button" onClick={() => setAll(!all)} className="kc-nav-row ps-8 text-tertiary">
							{all ? "Show less" : "Show more"}
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}

/**
 * The sidebar's right edge: a 16px handle centred on it that drags the width (Codex's). The width stops at its minimum;
 * dragging on past half of that, counted from the window's edge with the rail, slides the sidebar shut, and dragging
 * back opens it again (Codex's, measured 2026-10-19).
 */
function ResizeHandle({ width }: { width: number }) {
	const start = (event: React.PointerEvent) => {
		event.preventDefault();
		const from = event.clientX;
		const { left, right } = event.currentTarget.parentElement!.getBoundingClientRect();
		// Where the edge would be, offset by where on the handle it was grabbed.
		const collapseAt = (left + SIDEBAR_WIDTH.min) / 2 + from - right;
		let open = true;
		const onMove = (e: PointerEvent) => {
			const past = e.clientX < collapseAt;
			if (past === open) {
				open = !past;
				setSidebarOpen(open);
			}
			if (open) setSidebarWidth(width + e.clientX - from);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize sidebar"
			aria-valuenow={width}
			aria-valuemin={SIDEBAR_WIDTH.min}
			aria-valuemax={SIDEBAR_WIDTH.max}
			onPointerDown={start}
			onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH.default)}
			className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize"
		/>
	);
}

/** The sidebar's column, resizable from its right edge: the thread list, or the settings pages while Settings is open. */
export function SidebarFrame({ label, children }: { label: string; children: ReactNode }) {
	const width = useStore((s) => s.desktop?.sidebar.width ?? SIDEBAR_WIDTH.default);
	return (
		<aside
			aria-label={label}
			style={{ width }}
			className="kc-sidebar relative flex h-full shrink-0 flex-col bg-sidebar"
		>
			{children}
			<ResizeHandle width={width} />
		</aside>
	);
}

export function Sidebar() {
	const threads = useStore((s) => s.threads);
	const projects = useStore(selectProjects);
	const pins = useStore((s) => s.desktop?.pinnedThreads ?? NO_PINS);
	const folded = useStore((s) => s.desktop?.sidebar.collapsedSections ?? NO_SECTIONS);
	const organize = useStore((s) => sidebarOptionsOf(s).organize);
	const sort = useStore((s) => sidebarOptionsOf(s).sort);
	const view = useStore((s) => s.view);
	const [searching, setSearching] = useState(false);
	const [query, setQuery] = useState("");
	const [dialog, setDialog] = useState<SidebarDialog>();
	const [selection, setSelection] = useState<RowSelection>(NO_SELECTION);
	const selectedId = view.kind === "thread" ? view.id : undefined;
	const newCwd = view.kind === "new" ? view.cwd : undefined;
	const model = sidebarModel(threads, projects, pins, query, samePath, { organize, sort });
	const { pinned, attention, projects: groups, recent } = model;
	// Threads archived or deleted meanwhile drop out of the selection.
	const picked = threads.filter((t) => selection.ids.includes(t.id));
	const clearSelection = () => setSelection(NO_SELECTION);

	const activate = (thread: ThreadSummary, event: React.MouseEvent | React.KeyboardEvent) => {
		const toggle = isMac() ? event.metaKey : event.ctrlKey;
		if (toggle || event.shiftKey) {
			const order = threadSlots(model, folded).map((t) => t.id);
			setSelection(selectRows(selection, order, thread.id, event.shiftKey ? "range" : "toggle"));
			return;
		}
		clearSelection();
		void openThread(thread.id);
	};
	/** A row's Archive: the whole selection when the row is in one, after asking; otherwise just the row. */
	const archiveRow = (thread: ThreadSummary) => {
		if (picked.length > 1 && picked.includes(thread)) setDialog({ kind: "archive", threads: picked });
		else void archive(thread.id);
	};
	const row = (t: ThreadSummary, inset?: boolean) => (
		<ThreadRow
			key={t.id}
			thread={t}
			inset={inset}
			current={t.id === selectedId}
			picked={picked.includes(t)}
			pinned={pins.includes(t.id)}
			selectionSize={picked.length}
			onActivate={activate}
			onArchive={archiveRow}
			onDialog={setDialog}
			onClearSelection={clearSelection}
		/>
	);

	return (
		<SidebarFrame label="Threads">
			<div className="flex h-[52px] shrink-0 items-center justify-between ps-4 pe-3">
				<span className="text-[18px] leading-6 font-semibold text-nav">KnightCode</span>
				<IconButton
					label="Search threads"
					aria-pressed={searching}
					onClick={() => {
						setSearching(!searching);
						setQuery("");
					}}
				>
					<Search size={16} />
				</IconButton>
			</div>
			<div className="flex flex-col gap-px px-2">
				{searching ? (
					<input
						autoFocus
						value={query}
						aria-label="Search threads"
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (!matches(e, "desktop.picker.dismiss")) return;
							e.preventDefault();
							setSearching(false);
							setQuery("");
						}}
						placeholder="Search threads"
						className="kc-input mb-1 h-[30px] rounded-lg"
					/>
				) : null}
				<NavRow icon={<SquarePen size={16} />} label="New thread" onActivate={() => showNew()} />
			</div>
			{/* Codex leaves 12px between New thread and the first section heading. Escape drops a selection. */}
			<div
				className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-3 pb-2"
				onKeyDown={(event) => {
					if (picked.length === 0 || !matches(event, "desktop.picker.dismiss")) return;
					event.preventDefault();
					clearSelection();
				}}
			>
				{pinned.length > 0 ? (
					<Section id="pinned" title="Pinned">
						{pinned.map((t) => row(t))}
					</Section>
				) : null}
				{attention.length > 0 ? (
					<Section id="attention" title="Needs attention">
						{attention.map((t) => row(t))}
					</Section>
				) : null}
				{organize === "project" ? (
					<Section
						id="projects"
						title="Projects"
						actions={
							<>
								<SidebarOptionsMenu label="Project sidebar options" />
								<IconButton label="Add new project" size="xs" onClick={() => void addProject()}>
									<FolderPlus size={16} />
								</IconButton>
							</>
						}
					>
						{projects.length === 0 ? (
							<NavRow
								icon={<FolderPlus size={16} />}
								label="Add a project folder"
								onActivate={() => void addProject()}
							/>
						) : null}
						{groups.map((p) => (
							<ProjectGroup
								key={p.path}
								path={p.path}
								name={p.name}
								collapsed={p.collapsed}
								current={newCwd !== undefined && samePath(newCwd, p.path)}
								threads={p.threads}
								row={row}
								onDialog={setDialog}
							/>
						))}
					</Section>
				) : null}
				{recent.length > 0 || organize === "list" ? (
					<Section
						id="recents"
						title="Recents"
						actions={
							<>
								<SidebarOptionsMenu label="Thread sidebar options" />
								<IconButton label="New thread" size="xs" onClick={() => showNew()}>
									<SquarePen size={16} />
								</IconButton>
							</>
						}
					>
						{recent.map((t) => row(t))}
					</Section>
				) : null}
			</div>
			{dialog?.kind === "rename" ? (
				<RenameThreadDialog threadId={dialog.threadId} onClose={() => setDialog(undefined)} />
			) : dialog?.kind === "delete" ? (
				<DeleteThreadDialog thread={dialog.thread} onClose={() => setDialog(undefined)} />
			) : dialog?.kind === "remove" ? (
				<ConfirmDialog
					title={`Remove ${basename(dialog.path)}?`}
					description="This only removes the project from the sidebar. Files on your computer and existing threads won't be deleted."
					confirm="Remove project"
					onConfirm={() => removeProject(dialog.path)}
					onClose={() => setDialog(undefined)}
				/>
			) : dialog?.kind === "archive" ? (
				<ArchiveThreadsDialog
					threads={dialog.threads}
					project={dialog.project}
					onDone={clearSelection}
					onClose={() => setDialog(undefined)}
				/>
			) : null}
		</SidebarFrame>
	);
}
