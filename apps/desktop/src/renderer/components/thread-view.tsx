/**
 * One thread (desktop-shell.md section 9.3), laid out as Codex's (measured 2026-10-19): a 52px header with the
 * project icon, the title, Chat actions and Toggle summary; the transcript, which sticks to the bottom while streaming
 * and offers Scroll to bottom when it does not; older history on demand; approvals and dialogs in the composer's place; and the
 * side panel, resizable from its left edge, with its tab strip.
 */

import {
	AppWindow,
	ArrowDown,
	CircleAlert,
	File,
	FileDiff,
	Folder,
	GitBranchPlus,
	Globe,
	Maximize,
	Minimize,
	MoreHorizontal,
	PanelRight,
	Plus,
	SquarePlus,
	SquareTerminal,
	X,
} from "./icons.tsx";
import { BackgroundShellTab, commandLabel } from "./background-terminals.tsx";
import type React from "react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { basename, clockTime, dayLabel, SEPARATOR_GAP_MS } from "../format.ts";
import { bindingLabel, matches, useBinding, useBindings } from "../keys.ts";
import {
	activateTab,
	closeTab,
	copyLastCodeBlock,
	discardFileTab,
	dismissPending,
	fork,
	keepTab,
	loadEarlier,
	loadTerminals,
	newTerminal,
	openFilesTab,
	openPreview,
	NO_TABS,
	openThread,
	type PanelTab,
	rename,
	restoreWorktree,
	selectUnread,
	send,
	sendViewEvent,
	setFinding,
	setPanel,
	type State,
	toggleTerminal,
	useStore,
} from "../store.ts";
import { ConfirmDialog } from "./dialog.tsx";
import { FileTab } from "./file-tab.tsx";
import { FilesPanel, FilesTab } from "./files-panel.tsx";
import { StripSlot, StripTab } from "./strip-tab.tsx";
import { BottomRegion } from "./terminal.tsx";
import { PreviewTab, previewTitle } from "./preview.tsx";
import { type AppItem, McpAppView } from "./mcp-app.tsx";
import { FileIcon } from "./file-icon.tsx";
import { ApprovalCard } from "./approval.tsx";
import { DialogCard, QuestionsCard } from "./request-card.tsx";
import { Button, IconButton } from "./button.tsx";
import { ChangesPane } from "./changes.tsx";
import { FindBar } from "./find-bar.tsx";
import { ThreadSummary } from "./git.tsx";
import { Composer } from "./composer.tsx";
import { TurnView, UserBubble } from "./items.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuTrigger } from "./menu.tsx";
import { boundActions, DeleteThreadDialog, RenameThreadDialog, threadActions } from "./thread-actions.tsx";
import { Tooltip } from "./tooltip.tsx";
import { WidgetPanel } from "./view.tsx";
import { followDrag } from "../drag.ts";

const NO_PINS: string[] = [];

/** Codex's separator between turns far apart: "Yesterday 11:53 AM", 13px, the day in medium weight. */
function DateSeparator({ at }: { at: number }) {
	const day = dayLabel(at);
	return (
		<div role="separator" aria-label={`${day} ${clockTime(at)}`} className="flex justify-center py-4">
			<time className="text-sm leading-5 text-tertiary" dateTime={new Date(at).toISOString()}>
				<span className="font-medium">{day}</span> {clockTime(at)}
			</time>
		</div>
	);
}

/** Codex's "Chat actions" menu: an icon on every row, the copies gathered under one Copy submenu (thread-actions.tsx). */
function ThreadMenu({ thread }: { thread: { id: string; cwd: string; name: string; sessionFile?: string } }) {
	const { id } = thread;
	const pinned = useStore((s) => (s.desktop?.pinnedThreads ?? NO_PINS).includes(id));
	const unread = useStore((s) => selectUnread(s).includes(id));
	const [dialog, setDialog] = useState<"rename" | "delete">();
	const items = threadActions(thread, {
		pinned,
		unread,
		open: true,
		onRename: () => setDialog("rename"),
		onDelete: () => setDialog("delete"),
	});
	// The open thread's shortcuts run the same actions as its menu, and Codex's "Copy last code block", which no menu
	// lists.
	useBindings([...boundActions(items), { binding: "desktop.thread.copyCode", run: () => copyLastCodeBlock(id) }]);
	return (
		<>
			<Menu>
				<MenuTrigger>
					<IconButton label="Chat actions" className="no-drag">
						<MoreHorizontal size={16} />
					</IconButton>
				</MenuTrigger>
				<MenuContent align="end">
					{items.map((item, i) => {
						if (item === "-") return <MenuSeparator key={i} />;
						const Icon = item.icon;
						if ("items" in item)
							return (
								<MenuSub key={item.label} icon={Icon ? <Icon /> : undefined} label={item.label}>
									{item.items.map((sub) => (
										<MenuItem
											key={sub.label}
											hint={sub.binding ? bindingLabel(sub.binding) : undefined}
											danger={sub.danger}
											onSelect={sub.run}
										>
											{sub.label}
										</MenuItem>
									))}
								</MenuSub>
							);
						return (
							<MenuItem
								key={item.label}
								icon={Icon ? <Icon /> : undefined}
								hint={item.binding ? bindingLabel(item.binding) : undefined}
								danger={item.danger}
								onSelect={item.run}
							>
								{item.label}
							</MenuItem>
						);
					})}
				</MenuContent>
			</Menu>
			{dialog === "rename" ? <RenameThreadDialog threadId={id} onClose={() => setDialog(undefined)} /> : null}
			{dialog === "delete" ? <DeleteThreadDialog thread={thread} onClose={() => setDialog(undefined)} /> : null}
		</>
	);
}

const PANEL_MIN = 320;
/** The room Codex keeps for the chat beside the side panel. */
const CHAT_MIN = 352;

/** The side panel's CSS width: 54% of the thread view until dragged, and however it narrows, the chat keeps 352px. */
const panelWidth = (width: number) =>
	`min(${width ? `${width}px` : "54cqw"}, max(${PANEL_MIN}px, 100cqw - ${CHAT_MIN}px))`;

/**
 * The side panel's left edge: a 16px handle centred on it that drags the panel's width (Codex's, from its bundle,
 * 2026-10-20). The width stays between 320px and what leaves the chat 352px. Dragged under half the minimum the panel
 * slides shut; dragged past its maximum until the chat would be under half the minimum, the panel takes the chat's
 * place (full screen). Dragging back undoes either.
 */
function PanelResizeHandle() {
	const width = useStore((s) => s.panel.width);
	const start = (event: React.PointerEvent) => {
		event.preventDefault();
		const from = event.clientX;
		let panel = event.currentTarget.parentElement!;
		const initial = panel.getBoundingClientRect().width;
		// The thread view, past the panel's slot.
		const threadView = panel.parentElement!.parentElement!;
		const workspace = threadView.getBoundingClientRect().width;
		const max = Math.max(PANEL_MIN, workspace - CHAT_MIN);
		let shown = { open: true, full: false };
		let dragged: number | undefined;
		const onMove = (e: PointerEvent) => {
			const size = initial - (e.clientX - from);
			const open = size >= PANEL_MIN / 2;
			const full = size > max && workspace - size < PANEL_MIN / 2;
			const sized = open && !full ? Math.round(Math.min(Math.max(size, PANEL_MIN), max)) : undefined;
			if (sized !== undefined) dragged = sized;
			// Shutting, opening and full screen go through the store; a width alone only restyles the panel.
			if (open !== shown.open || full !== shown.full) {
				shown = { open, full };
				setPanel(sized === undefined ? { open, full } : { open, full, width: sized });
			} else if (sized !== undefined) {
				// Shut long enough to unmount and shown again in this drag, the panel is a new element in the thread view.
				if (!panel.isConnected) panel = threadView.querySelector<HTMLElement>(".kc-panel-slot > aside") ?? panel;
				panel.style.width = panelWidth(sized);
				panel.querySelector(":scope > [role=separator]")?.setAttribute("aria-valuenow", `${sized}`);
			}
		};
		followDrag(onMove, () => {
			if (dragged !== undefined) setPanel({ width: dragged });
		});
	};
	return (
		<div
			onPointerDown={start}
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize workspace panes"
			aria-valuenow={width || undefined}
			aria-valuemin={PANEL_MIN}
			className="absolute inset-y-0 -left-2 z-10 w-4 cursor-col-resize"
		/>
	);
}

/** The call a full-screen app tab belongs to, from the thread's turns. */
function appItemOf(threadId: string, itemId: string) {
	return (s: State) =>
		s.held[threadId]?.turns
			.flatMap((t) => t.items)
			.find((i): i is AppItem => i.id === itemId && i.type === "toolCall" && i.mcpApp !== undefined);
}

function TabButton({
	threadId,
	tab,
	index,
	active,
}: {
	threadId: string;
	tab: PanelTab;
	index: number;
	active: boolean;
}) {
	const app = useStore(tab.kind === "mcpApp" ? appItemOf(threadId, tab.itemId) : () => undefined);
	return (
		<StripTab
			icon={
				tab.kind === "changes" ? (
					<FileDiff size={16} className="shrink-0" />
				) : tab.kind === "preview" ? (
					<Globe size={16} className="shrink-0" />
				) : tab.kind === "mcpApp" ? (
					<AppWindow size={16} className="shrink-0" />
				) : tab.kind === "files" ? (
					<File size={16} className="shrink-0" />
				) : tab.kind === "backgroundShell" ? (
					<SquareTerminal size={16} className="shrink-0" />
				) : (
					<FileIcon path={tab.path} />
				)
			}
			title={
				tab.kind === "changes"
					? "Changes"
					: tab.kind === "preview"
						? previewTitle(tab)
						: tab.kind === "mcpApp"
							? (app?.mcpApp.server ?? "App")
							: tab.kind === "files"
								? "Open file"
								: tab.kind === "backgroundShell"
									? commandLabel(tab.command)
									: basename(tab.path)
			}
			italic={tab.kind === "file" && tab.preview}
			dirty={tab.kind === "file" && tab.draft !== undefined}
			active={active}
			onSelect={() => activateTab(threadId, index)}
			onKeep={() => keepTab(threadId, index)}
			onClose={() => closeTab(threadId, index)}
		/>
	);
}

/** An app full screen (section 12.2): the call's app filling the panel; gone with its call. */
function AppTab({ threadId, itemId }: { threadId: string; itemId: string }) {
	const item = useStore(appItemOf(threadId, itemId));
	if (!item) return <div className="p-4 text-sm text-tertiary">This app's call is no longer in the thread.</div>;
	return (
		<div className="flex min-h-0 flex-1 flex-col p-2">
			<McpAppView threadId={threadId} item={item} mode="fullscreen" />
		</div>
	);
}

/** The right region (desktop-shell.md section 9.6): a tab strip over the chosen tab. */
function SidePanel({ id }: { id: string }) {
	const width = useStore((s) => s.panel.width);
	const full = useStore((s) => s.panel.full ?? false);
	const { tabs, active } = useStore((s) => s.tabs[id] ?? NO_TABS);
	const shown = tabs[active];
	const discarding = useStore((s) => s.discarding);
	const strip = useRef<HTMLDivElement>(null);
	// A strip wider than the panel scrolls the chosen tab, close button included, into sight.
	useEffect(() => {
		strip.current
			?.querySelector("[aria-selected=true]")
			?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [active, tabs.length]);
	useBinding(
		"desktop.panel.closeTab",
		() => {
			if (active === 0) return false;
			closeTab(id, active);
		},
		active !== 0,
	);
	return (
		<aside
			// The whole thread view (its container) in full screen.
			style={{ width: full ? "100cqw" : panelWidth(width), minWidth: PANEL_MIN }}
			className={`relative flex h-full shrink-0 flex-col bg-surface ${full ? "" : "border-l border-line"}`}
		>
			{/* As in Codex, a full-screen panel resizes only while a drag that made it so is still going. */}
			{full ? null : <PanelResizeHandle />}
			<div className="flex h-[52px] shrink-0 items-center gap-1.5 ps-2 pe-3">
				{/* Wider than the panel, the strip scrolls sideways. */}
				<div
					ref={strip}
					role="tablist"
					aria-label="Chat tabs"
					className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]"
				>
					{tabs.map((tab, i) => (
						<StripSlot
							key={
								tab.kind === "file"
									? tab.path
									: tab.kind === "preview"
										? tab.id
										: tab.kind === "mcpApp"
											? `app:${tab.itemId}`
											: tab.kind === "backgroundShell"
												? `background:${tab.id}`
												: tab.kind === "files"
													? "files"
													: "changes"
							}
							divider={i !== active && i + 1 !== active && i !== tabs.length - 1}
						>
							<TabButton threadId={id} tab={tab} index={i} active={i === active} />
						</StripSlot>
					))}
				</div>
				{/* New tab, right after the tabs: a preview on its new tab page. */}
				<IconButton label="New tab" onClick={() => openPreview(id)}>
					<Plus size={16} />
				</IconButton>
				<div className="flex-1" />
				<IconButton
					label={full ? "Exit full screen" : "Enter full screen"}
					aria-pressed={full}
					onClick={() => setPanel({ full: !full })}
				>
					{full ? <Minimize size={16} /> : <Maximize size={16} />}
				</IconButton>
				<IconButton label="Hide tabs" aria-pressed="true" onClick={() => setPanel({ open: false })}>
					<PanelRight size={16} filled />
				</IconButton>
			</div>
			{/* Changes stays mounted behind a file tab, keeping its scope, scroll and drafts. */}
			<div className={active === 0 ? "contents" : "hidden"}>
				<ChangesPane threadId={id} />
			</div>
			{/* File tabs and "Open file" share one tree, kept as it is from one file to the next. */}
			{shown?.kind === "file" || shown?.kind === "files" ? (
				<FilesPanel threadId={id} autoFocus={shown.kind === "files"}>
					{(beside) =>
						shown.kind === "file" ? (
							<FileTab
								key={shown.path}
								threadId={id}
								path={shown.path}
								line={shown.line}
								used={shown.used}
								compare={shown.compare}
								draft={shown.draft}
								beside={beside}
							/>
						) : (
							<FilesTab threadId={id} />
						)
					}
				</FilesPanel>
			) : null}
			{shown?.kind === "mcpApp" ? <AppTab key={shown.itemId} threadId={id} itemId={shown.itemId} /> : null}
			{shown?.kind === "backgroundShell" ? <BackgroundShellTab key={shown.id} threadId={id} id={shown.id} /> : null}
			{/* Previews stay mounted behind the other tabs, keeping their pages. */}
			{tabs.map((tab, i) =>
				tab.kind === "preview" ? <PreviewTab key={tab.id} threadId={id} tab={tab} active={i === active} /> : null,
			)}
			{discarding?.threadId === id ? (
				<ConfirmDialog
					title="Discard file changes?"
					description="Your unsaved changes to this file will be lost"
					cancel="Continue viewing"
					confirm="Discard changes"
					onConfirm={() => discardFileTab(discarding.threadId, discarding.path)}
					onClose={() => discardFileTab()}
				/>
			) : null}
		</aside>
	);
}

export function ThreadView({ id }: { id: string }) {
	const view = useStore((s) => s.held[id]);
	const failure = useStore((s) => s.opening[id]);
	const summary = useStore((s) => s.threads.find((t) => t.id === id));
	const panelOpen = useStore((s) => s.panel.open);
	const panelFull = useStore((s) => s.panel.open && (s.panel.full ?? false));
	// The side panel stays mounted while it slides shut (styles.css, .kc-panel-slot), and slides open only when opened
	// here, not when a thread opens with the panel already up.
	const [panelShown, setPanelShown] = useState<"open" | "opened" | false>(panelOpen && "open");
	if (panelOpen && !panelShown) setPanelShown("opened");
	const progress = useStore((s) => s.progress[id]);
	const scroller = useRef<HTMLDivElement>(null);
	const header = useRef<HTMLElement>(null);
	const [pinned, setPinned] = useState(true);
	const [renaming, setRenaming] = useState<string | undefined>();
	const [loadingEarlier, setLoadingEarlier] = useState(false);

	useEffect(() => {
		setPinned(true);
		setRenaming(undefined);
	}, [id]);
	useLayoutEffect(() => {
		const el = scroller.current;
		if (el && pinned) el.scrollTop = el.scrollHeight;
	});
	useBinding("desktop.panel.toggle", () => setPanel({ open: !panelOpen }));
	useBinding("desktop.files.open", () => {
		openFilesTab(id);
		// An "Open file" tab already showing keeps its tree: focus its filter again.
		requestAnimationFrame(() => document.getElementById("kc-files-filter")?.focus());
	});
	const bottomOpen = useStore((s) => s.terminals[id]?.open ?? false);
	// Terminals main still runs for this thread (a reload, a second window) come back as its tabs.
	useEffect(() => {
		void loadTerminals(id).catch(() => {});
	}, [id]);
	const finding = useStore((s) => s.finding);
	useBinding("desktop.thread.find", () => setFinding(true), !finding);
	// A find belongs to the thread it searched.
	useEffect(() => () => setFinding(false), [id]);

	const name = view?.thread.name || summary?.name || "Untitled";
	const cwd = view?.thread.cwd ?? summary?.cwd ?? "";
	useBinding("desktop.terminal.toggle", () => toggleTerminal(id, cwd), Boolean(view));
	useBinding("desktop.terminal.new", () => void newTerminal(id, cwd), Boolean(view));
	useBinding("desktop.preview.open", () => openPreview(id), Boolean(view));
	const commitRename = () => {
		const value = renaming?.trim();
		setRenaming(undefined);
		if (value && value !== name) void rename(id, value);
	};

	// An extension's title names the window while this thread is open in it; the thread's own name stays the user's.
	const extensionTitle = view?.ui.title;
	useEffect(() => {
		document.title = extensionTitle ?? "KnightCode";
		return () => {
			document.title = "KnightCode";
		};
	}, [extensionTitle]);

	// The approval or dialog the server waits on longest takes the composer's place.
	const asking = view?.requests[0];
	const workspace = view?.thread.workspace;
	const project = basename(view?.thread.projectCwd ?? summary?.projectCwd ?? cwd);
	const deleted = (failure?.data as { reason?: string } | undefined)?.reason === "worktreeDeleted";
	return (
		// The bottom region (terminals) spans the chat and the side panel, under both.
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<div className="@container flex min-h-0 min-w-0 flex-1">
				{/* Hidden, not unmounted, while the side panel is full screen, so the transcript and a draft stay put. */}
				<div className={`h-full min-w-0 flex-1 flex-col ${panelFull ? "hidden" : "flex"}`}>
					<header ref={header} className="flex h-[52px] shrink-0 items-center gap-2 ps-3.5 pe-1.5">
						<Tooltip content={cwd} side="bottom" align="start">
							<span
								role="img"
								aria-label={workspace?.mode === "worktree" ? `Worktree of ${project}` : `Project: ${project}`}
								className="flex size-7 shrink-0 items-center justify-center text-tertiary"
							>
								{workspace?.mode === "worktree" ? <GitBranchPlus size={16} /> : <Folder size={16} />}
							</span>
						</Tooltip>
						{renaming !== undefined ? (
							<input
								autoFocus
								aria-label="Thread title"
								value={renaming}
								onChange={(e) => setRenaming(e.target.value)}
								onBlur={commitRename}
								onKeyDown={(e) => {
									if (matches(e, "desktop.item.activate")) commitRename();
									if (matches(e, "desktop.picker.dismiss")) {
										e.preventDefault();
										setRenaming(undefined);
									}
								}}
								className="kc-input h-7 min-w-0 flex-1 text-base font-medium"
							/>
						) : (
							<Tooltip content={name} side="bottom" align="start" overflow>
								<button
									type="button"
									onDoubleClick={() => setRenaming(name)}
									className="min-w-0 truncate px-1.5 text-start text-base leading-6 font-medium text-ink"
								>
									{name}
								</button>
							</Tooltip>
						)}
						<div className="flex-1" />
						{view?.ui.statuses.map((status) => (
							<Tooltip key={status.key} content={status.text} side="bottom">
								<span className="max-w-[200px] shrink truncate rounded-md border border-line px-2 text-sm text-secondary">
									{status.text}
								</span>
							</Tooltip>
						))}
						<div className="flex items-center gap-1.5">
							<ThreadMenu thread={{ id, cwd, name, sessionFile: view?.thread.sessionFile }} />
							{view ? <ThreadSummary thread={view.thread} anchor={header} /> : null}
							{panelOpen ? null : (
								<>
									<div className="mx-px h-4 w-px bg-line" />
									<IconButton label="Show tabs" className="no-drag" onClick={() => setPanel({ open: true })}>
										<SquarePlus size={16} />
									</IconButton>
								</>
							)}
						</div>
					</header>
					{finding ? <FindBar root={scroller} onClose={() => setFinding(false)} /> : null}
					<div
						ref={scroller}
						onScroll={(e) => {
							const el = e.currentTarget;
							setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
						}}
						className="kc-fade-y relative min-h-0 flex-1 overflow-y-auto"
					>
						<div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-8 pb-12">
							{view?.nextCursor ? (
								<div className="flex justify-center">
									<Button
										variant="ghost"
										color="secondary"
										size="sm"
										pill
										disabled={loadingEarlier}
										onClick={() => {
											setLoadingEarlier(true);
											setPinned(false);
											void loadEarlier(id).finally(() => setLoadingEarlier(false));
										}}
									>
										{loadingEarlier ? "Loading…" : "Load earlier messages"}
									</Button>
								</div>
							) : null}
							{failure ? (
								<div className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">
									<CircleAlert size={14} className="shrink-0" />
									<span className="min-w-0 flex-1">
										{deleted ? "The worktree of this thread was deleted. Restore it to continue." : failure.message}
									</span>
									{failure.code === "threadLockedElsewhere" ? (
										<Button variant="ghost" color="danger" size="sm" onClick={() => void fork(id)}>
											Fork it
										</Button>
									) : null}
									<Button
										variant="soft"
										color="danger"
										size="sm"
										onClick={() => void (deleted ? restoreWorktree(id) : openThread(id))}
									>
										{deleted ? "Restore" : "Retry"}
									</Button>
								</div>
							) : null}
							{!view && !failure ? <div className="kc-pulse text-sm text-tertiary">Loading…</div> : null}
							{workspace?.mode === "worktree" && workspace.setupFailed ? (
								<div className="flex items-center gap-2 rounded-lg bg-soft-alt px-3 py-2 text-sm text-secondary">
									<CircleAlert size={14} className="shrink-0" /> The environment's setup script failed; the worktree is
									ready without it.
								</div>
							) : null}
							{progress && view?.turns.length === 0 ? (
								<pre className="max-h-48 overflow-auto rounded-lg bg-surface-secondary px-3 py-2 font-code text-code text-secondary">
									{progress}
								</pre>
							) : null}
							{view?.turns.map((turn, i) => {
								const before = view.turns[i - 1];
								const separate = before
									? turn.startedAt - before.startedAt >= SEPARATOR_GAP_MS
									: dayLabel(turn.startedAt) !== "Today";
								return (
									<Fragment key={turn.id}>
										{separate ? <DateSeparator at={turn.startedAt} /> : null}
										<TurnView
											turn={turn}
											threadId={id}
											latest={i === view.turns.length - 1}
											retry={turn.status === "inProgress" ? view.retry : undefined}
										/>
									</Fragment>
								);
							})}
							{view?.pending.map((p) => (
								<UserBubble
									key={p.clientMessageId}
									text={p.text}
									pending={!p.failed}
									failed={p.failed}
									onRetry={() => {
										dismissPending(id, p.clientMessageId);
										void send(id, p.text, p.images);
									}}
									onDismiss={() => dismissPending(id, p.clientMessageId)}
								/>
							))}
						</div>
					</div>
					{/* Scroll to bottom: a 32px round button over the composer, faded out while pinned. The negative
					    margin pulls it and the composer 1rem over the transcript's faded tail. */}
					<div className="relative -mt-4">
						<Tooltip content="Scroll to bottom">
							<Button
								variant="outline"
								size="lg"
								uniform
								pill
								aria-label="Scroll to bottom"
								tabIndex={pinned ? -1 : 0}
								onClick={() => setPinned(true)}
								className={`absolute -top-14 left-1/2 -translate-x-1/2 bg-surface text-secondary transition-opacity duration-150 ${pinned ? "pointer-events-none opacity-0" : "opacity-100"}`}
							>
								<ArrowDown size={20} className="text-ink" />
							</Button>
						</Tooltip>
					</div>
					{/* Extension widgets, above the request or composer so they stay in sight while an approval is asked. */}
					{view ? (
						<WidgetPanel
							widgets={view.ui.widgets}
							onEvent={(key, control, value) => sendViewEvent(id, key, control, value)}
						/>
					) : null}
					{/* A request takes the composer's place; the composer stays mounted so a draft survives. */}
					{/* Positioned so it paints over the transcript it overlaps. */}
					<div className="relative">
						{asking?.method === "item/toolCall/requestApproval" ? (
							<ApprovalCard key={String(asking.id)} threadId={id} approval={asking} cwd={cwd} />
						) : asking?.method === "ui/dialog" ? (
							<DialogCard key={String(asking.id)} threadId={id} dialog={asking} />
						) : asking?.method === "item/toolCall/requestUserInput" ? (
							<QuestionsCard key={String(asking.id)} threadId={id} request={asking} />
						) : null}
						<div className={asking ? "hidden" : undefined}>
							<Composer threadId={id} />
						</div>
					</div>
				</div>
				{panelShown && view ? (
					<div
						className="kc-panel-slot flex shrink-0"
						data-open={panelOpen || undefined}
						data-enter={panelShown === "opened" || undefined}
						inert={!panelOpen}
						onTransitionEnd={(e) => {
							if (e.target === e.currentTarget && !panelOpen) setPanelShown(false);
						}}
					>
						<SidePanel id={id} />
					</div>
				) : null}
			</div>
			{bottomOpen && view ? <BottomRegion threadId={id} cwd={cwd} /> : null}
		</div>
	);
}
