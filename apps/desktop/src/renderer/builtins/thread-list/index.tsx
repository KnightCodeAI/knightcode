/** Built-in thread list and rows; state and actions come only from the public SDK. */
import type React from "react";
import { type ReactNode, useState } from "react";
import {
	defineDesktopExtension,
	experimental_controllers,
	experimental_controls,
	experimental_icons,
	experimental_shellServices,
	experimental_useNavigation,
	experimental_useThreadList,
	experimental_Slots as Slots,
	type experimental_Thread as ThreadSummary,
	type experimental_RowSelection as RowSelection,
	type experimental_ContextMenuItem as ContextMenuItem,
} from "@knightcodeai/cli/desktop";
const PROJECT_PAGE = 10;
const contextMenu = (items: () => ContextMenuItem[]) => (event: React.MouseEvent) => {
	event.preventDefault();
	event.stopPropagation();
	void experimental_shellServices().experimental_showContextMenu(items());
};
const basename = (path: string) => experimental_shellServices().experimental_basename(path);
const samePath = (a: string, b: string) => experimental_shellServices().experimental_samePath(a, b);
const NO_SELECTION: RowSelection = { ids: [] };

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

type SidebarDialog =
	| { kind: "rename"; threadId: string }
	| { kind: "delete"; thread: ThreadSummary }
	| { kind: "remove"; path: string }
	| { kind: "archive"; threads: ThreadSummary[]; project?: string };

function StatusMark({ thread, unread }: { thread: ThreadSummary; unread: boolean }) {
	const { status } = thread;
	const { experimental_Tooltip: Tooltip } = experimental_controls();
	const { GitBranchPlus } = experimental_icons();
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

function CardRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className="flex size-4 shrink-0 items-center justify-center text-tertiary">{icon}</span>
			<span className="min-w-0 truncate">{children}</span>
		</div>
	);
}

function ThreadCard({ thread }: { thread: ThreadSummary }) {
	const { Folder, GitBranchPlus, CircleAlert } = experimental_icons();
	const { experimental_messageTime: messageTime } = experimental_shellServices();
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

	picked: boolean;
	pinned: boolean;
	inset?: boolean;
	selectionSize: number;
	onActivate: (thread: ThreadSummary, event: React.MouseEvent | React.KeyboardEvent) => void;
	onArchive: (thread: ThreadSummary) => void;
	onDialog: (dialog: SidebarDialog) => void;
	onClearSelection: () => void;
}) {
	const unread = experimental_useThreadList().unread.includes(thread.id);
	const {
		experimental_HoverCard: HoverCard,
		experimental_NavRow: NavRow,
		experimental_IconButton: IconButton,
	} = experimental_controls();
	const { PinOff, Pin, Archive } = experimental_icons();
	const { experimental_pinThread: pinThread } = experimental_controllers();
	const items = (): ContextMenuItem[] =>
		picked && selectionSize > 1
			? [
					{ label: `Archive ${plural(selectionSize, "thread")}`, run: () => onArchive(thread) },
					"-",
					{ label: "Clear selection", run: onClearSelection },
				]
			: experimental_shellServices().experimental_threadMenu(thread, {
					pinned,
					unread,
					open: current,
					onRename: () => onDialog({ kind: "rename", threadId: thread.id }),
					onDelete: () => onDialog({ kind: "delete", thread }),
				});
	return (
		<HoverCard content={<ThreadCard thread={thread} />}>
			<NavRow
				inset={inset}
				label={
					<>
						{thread.name || "Untitled"}
						<Slots surface="threadRowMetadata" thread={thread} />
					</>
				}
				current={current}
				selected={picked}
				onActivate={(event) => onActivate(thread, event)}
				onContextMenu={contextMenu(items)}
				status={
					<>
						<StatusMark thread={thread} unread={unread} />
						<Slots surface="threadRowStatus" thread={thread} />
					</>
				}
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
						<Slots surface="threadRowActions" thread={thread} />
					</>
				}
			/>
		</HoverCard>
	);
}

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
	const folded = experimental_useThreadList().folded.includes(id);
	const { ChevronRight } = experimental_icons();
	const { experimental_toggleSection: toggleSection } = experimental_shellServices();
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
					<div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
						{actions}
					</div>
				) : null}
			</div>
			{folded ? null : <div className="flex flex-col gap-px pt-1">{children}</div>}
		</section>
	);
}

function SidebarOptionsMenu({ label }: { label: string }) {
	const { organize, sort } = experimental_useThreadList();
	const {
		experimental_Menu: Menu,
		experimental_MenuTrigger: MenuTrigger,
		experimental_IconButton: IconButton,
		experimental_MenuContent: MenuContent,
		experimental_MenuSub: MenuSub,
		experimental_MenuRadioGroup: MenuRadioGroup,
		experimental_MenuRadioItem: MenuRadioItem,
	} = experimental_controls();
	const { MoreHorizontal, PanelLeft, Folder, List, ArrowDownUp } = experimental_icons();
	const { experimental_setSidebarOption: setSidebarOption } = experimental_shellServices();
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
	const { experimental_ConfirmDialog: ConfirmDialog } = experimental_controls();
	const { experimental_archiveThreads: archiveThreads } = experimental_shellServices();
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
	const {
		experimental_HoverCard: HoverCard,
		experimental_NavRow: NavRow,
		experimental_Menu: Menu,
		experimental_MenuTrigger: MenuTrigger,
		experimental_IconButton: IconButton,
		experimental_MenuContent: MenuContent,
		experimental_MenuItem: MenuItem,
		experimental_MenuSeparator: MenuSeparator,
	} = experimental_controls();
	const { Folder, FolderOpen, MoreHorizontal, SquarePen, Archive } = experimental_icons();
	const { experimental_showNew: showNew } = experimental_controllers();
	const { experimental_toggleProject: toggleProject } = experimental_shellServices();
	const [all, setAll] = useState(false);
	const shown = all ? threads : threads.slice(0, PROJECT_PAGE);
	const label = name ?? basename(path);
	const showInFolder = () => void experimental_shellServices().experimental_showInFolder(path);
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

function ResizeHandle({ width }: { width: number }) {
	const {
		experimental_sidebarWidth: SIDEBAR_WIDTH,
		experimental_setSidebarWidth: setSidebarWidth,
		experimental_followDrag: followDrag,
	} = experimental_shellServices();
	const { experimental_setSidebarOpen: setSidebarOpen } = experimental_controllers();
	const clampSidebarWidth = (value: number) =>
		Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, value)));
	const start = (event: React.PointerEvent) => {
		event.preventDefault();
		const from = event.clientX;
		const handle = event.currentTarget;
		const column = handle.parentElement!;
		const { left, right } = column.getBoundingClientRect();

		const collapseAt = (left + SIDEBAR_WIDTH.min) / 2 + from - right;
		let open = true;
		let size = width;
		const onMove = (e: PointerEvent) => {
			const past = e.clientX < collapseAt;
			if (past === open) {
				open = !past;
				setSidebarOpen(open);
			}
			if (!open) return;
			size = clampSidebarWidth(width + e.clientX - from);

			if (!column.isConnected) return setSidebarWidth(size);
			column.style.width = `${size}px`;
			handle.setAttribute("aria-valuenow", `${size}`);
		};
		followDrag(onMove, () => {
			if (size !== width) setSidebarWidth(size);
		});
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

export function SidebarFrame({ label, children }: { label: string; children: ReactNode }) {
	const { width } = experimental_useThreadList();
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
	const { threads, projects, pins, folded, organize, sort } = experimental_useThreadList();
	const { view } = experimental_useNavigation();
	const {
		experimental_IconButton: IconButton,
		experimental_NavRow: NavRow,
		experimental_RenameThreadDialog: RenameThreadDialog,
		experimental_DeleteThreadDialog: DeleteThreadDialog,
		experimental_ConfirmDialog: ConfirmDialog,
	} = experimental_controls();
	const { Search, SquarePen, FolderPlus } = experimental_icons();
	const {
		experimental_showNew: showNew,
		experimental_addProject: addProject,
		experimental_openThread: openThread,
		experimental_archiveThread: archive,
		experimental_removeProject: removeProject,
	} = experimental_controllers();
	const {
		experimental_sidebarModel: sidebarModel,
		experimental_threadSlots: threadSlots,
		experimental_selectRows: selectRows,
		experimental_matches: matches,
		experimental_isMac: isMac,
	} = experimental_shellServices();
	const [searching, setSearching] = useState(false);
	const [query, setQuery] = useState("");
	const [dialog, setDialog] = useState<SidebarDialog>();
	const [selection, setSelection] = useState<RowSelection>(NO_SELECTION);
	const selectedId = view.kind === "thread" ? view.id : undefined;
	const newCwd = view.kind === "new" ? view.cwd : undefined;
	const model = sidebarModel(threads, projects, pins, query, samePath, { organize, sort });
	const { pinned, attention, projects: groups, recent } = model;

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

/** Shared single-row presenter for alternate lists, with the same menu and confirmation dialogs. */
export function SharedThreadRow({ threadId, inset }: { threadId: string; inset?: boolean }) {
	const { threads, pins } = experimental_useThreadList();
	const { view } = experimental_useNavigation();
	const [dialog, setDialog] = useState<SidebarDialog>();
	const { experimental_RenameThreadDialog: RenameThreadDialog, experimental_DeleteThreadDialog: DeleteThreadDialog } =
		experimental_controls();
	const { experimental_openThread: openThread, experimental_archiveThread: archive } = experimental_controllers();
	const thread = threads.find((t) => t.id === threadId);
	if (!thread) return null;
	return (
		<>
			<ThreadRow
				thread={thread}
				inset={inset}
				current={view.kind === "thread" && view.id === thread.id}
				picked={false}
				pinned={pins.includes(thread.id)}
				selectionSize={0}
				onActivate={() => void openThread(thread.id)}
				onArchive={() => void archive(thread.id)}
				onDialog={setDialog}
				onClearSelection={() => {}}
			/>
			{dialog?.kind === "rename" ? (
				<RenameThreadDialog threadId={dialog.threadId} onClose={() => setDialog(undefined)} />
			) : dialog?.kind === "delete" ? (
				<DeleteThreadDialog thread={dialog.thread} onClose={() => setDialog(undefined)} />
			) : null}
		</>
	);
}
export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "default", surface: "threadList", experimental_render: Sidebar });
});
