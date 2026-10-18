/**
 * One thread (desktop-shell.md section 9.3): a header with the thread menu, the transcript that sticks
 * to the bottom while streaming, older history on demand, approvals and the composer.
 */

import { ArrowDown, CircleAlert, FileDiff, Folder, GitBranchPlus, MoreHorizontal, PanelRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { client } from "../client.ts";
import { basename } from "../format.ts";
import { matches, useBinding } from "../keys.ts";
import {
	archive,
	compact,
	dismissPending,
	fork,
	loadEarlier,
	openThread,
	pinThread,
	rename,
	restoreWorktree,
	send,
	setPanel,
	transcriptMarkdown,
	useStore,
} from "../store.ts";
import { ApprovalCard } from "./approval.tsx";
import { ChangesPane } from "./changes.tsx";
import { ThreadSummary } from "./git.tsx";
import { Composer } from "./composer.tsx";
import { TurnView, UserBubble } from "./items.tsx";
import { MenuItem, Popover } from "./popover.tsx";

const NO_PINS: string[] = [];

function ThreadMenu({ id, cwd, onRename }: { id: string; cwd: string; onRename: () => void }) {
	const pinned = useStore((s) => (s.desktop?.pinnedThreads ?? NO_PINS).includes(id));
	const copy = (text: string) => void client.host("host/clipboard/writeText", { text });
	const Separator = () => <div className="my-1 border-t border-line" />;
	return (
		<Popover
			side="bottom"
			align="right"
			trigger={(open) => (
				<button
					type="button"
					title="Thread menu"
					className={`no-drag flex size-8 items-center justify-center rounded-lg ${open ? "bg-hover text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
				>
					<MoreHorizontal size={17} />
				</button>
			)}
		>
			{(close) => {
				const item = (label: string, run: () => void, danger = false) => (
					<MenuItem
						danger={danger}
						onClick={() => {
							close();
							run();
						}}
					>
						{label}
					</MenuItem>
				);
				return (
					<div className="w-60">
						{item("Rename", onRename)}
						{item(pinned ? "Unpin" : "Pin", () => pinThread(id, !pinned))}
						<Separator />
						{item("Fork", () => void fork(id))}
						{item("Compact context", () => void compact(id))}
						<Separator />
						{item("Copy transcript as Markdown", () => copy(transcriptMarkdown(id)))}
						{item("Copy working directory", () => copy(cwd))}
						{item("Copy thread id", () => copy(id))}
						{item("Show in folder", () => void client.host("host/shell/showInFolder", { path: cwd }))}
						<Separator />
						{item("Archive", () => void archive(id), true)}
					</div>
				);
			}}
		</Popover>
	);
}

/** The right region (desktop-shell.md section 9.6): the Changes pane, resizable from its left edge. */
function SidePanel({ id }: { id: string }) {
	const width = useStore((s) => s.panel.width);
	const startResize = (event: React.PointerEvent) => {
		const panel = event.currentTarget.parentElement!;
		const right = panel.getBoundingClientRect().right;
		const onMove = (e: PointerEvent) =>
			setPanel({ width: Math.max(320, Math.min(right - e.clientX, window.innerWidth - 420)) });
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};
	return (
		<aside
			style={width ? { width } : undefined}
			className="relative flex h-full w-[67%] min-w-[320px] shrink-0 flex-col border-l border-hairline bg-surface"
		>
			<div
				onPointerDown={startResize}
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize panel"
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
			/>
			{/* Codex's tab strip: one "Changes" tab (other tabs come with the terminal and files panes). */}
			<div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line ps-2 pe-2">
				<div className="relative flex h-8 w-[238px] min-w-0 items-center rounded-[10px] border border-[rgb(255_255_255/0.157)] bg-row shadow-[0_1px_2px_-1px_rgb(0_0_0/0.25)]">
					<span className="flex min-w-0 flex-1 items-center gap-2 ps-2.5 text-[13px] leading-[18.5px] text-ink">
						<FileDiff size={16} className="shrink-0" />
						<span className="truncate">Changes</span>
					</span>
					<button
						type="button"
						aria-label="Close Changes tab"
						onClick={() => setPanel({ open: false })}
						className="me-1.5 flex size-5 items-center justify-center rounded-[10px] text-desc hover:bg-ghost-hover hover:text-ink"
					>
						<X size={14} />
					</button>
				</div>
				<div className="flex-1" />
				<button
					type="button"
					aria-label="Hide tabs"
					title="Hide tabs"
					onClick={() => setPanel({ open: false })}
					className="flex size-7 items-center justify-center rounded-[12.5px] bg-[rgb(255_255_255/0.05)] text-ink"
				>
					<PanelRight size={16} />
				</button>
			</div>
			<ChangesPane threadId={id} />
		</aside>
	);
}

export function ThreadView({ id }: { id: string }) {
	const view = useStore((s) => s.held[id]);
	const failure = useStore((s) => s.opening[id]);
	const summary = useStore((s) => s.threads.find((t) => t.id === id));
	const panelOpen = useStore((s) => s.panel.open);
	const progress = useStore((s) => s.progress[id]);
	const scroller = useRef<HTMLDivElement>(null);
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
	useBinding("desktop.thread.archive", () => void archive(id));
	useBinding("desktop.panel.toggle", () => setPanel({ open: !panelOpen }));

	const name = view?.thread.name || summary?.name || "Untitled";
	const cwd = view?.thread.cwd ?? summary?.cwd ?? "";
	const commitRename = () => {
		const value = renaming?.trim();
		setRenaming(undefined);
		if (value && value !== name) void rename(id, value);
	};

	const workspace = view?.thread.workspace;
	const deleted = (failure?.data as { reason?: string } | undefined)?.reason === "worktreeDeleted";
	return (
		<div className="flex h-full min-w-0 flex-1">
			<div className="flex h-full min-w-0 flex-1 flex-col">
				<header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-5">
					{workspace?.mode === "worktree" ? (
						<GitBranchPlus size={16} className="shrink-0 text-muted" aria-label="Worktree" />
					) : (
						<Folder size={16} className="shrink-0 text-muted" />
					)}
					{renaming !== undefined ? (
						<input
							autoFocus
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
							className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 font-medium outline-none"
						/>
					) : (
						<button
							type="button"
							onDoubleClick={() => setRenaming(name)}
							title={`${name}\n${cwd}`}
							className="min-w-0 truncate text-left text-[15px] font-medium"
						>
							{name}
						</button>
					)}
					{cwd && renaming === undefined ? (
						<span className="hidden min-w-0 shrink truncate text-[13px] text-faint lg:block" title={cwd}>
							{basename(cwd)}
						</span>
					) : null}
					<div className="flex-1" />
					<ThreadMenu id={id} cwd={cwd} onRename={() => setRenaming(name)} />
					{view ? <ThreadSummary thread={view.thread} /> : null}
					{panelOpen ? null : (
						<>
							<div className="mx-1 h-4 border-l border-line" />
							<button
								type="button"
								title="Toggle diff panel"
								aria-label="Toggle diff panel"
								onClick={() => setPanel({ open: true })}
								className="no-drag flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink"
							>
								<PanelRight size={16} />
							</button>
						</>
					)}
				</header>
				<div
					ref={scroller}
					onScroll={(e) => {
						const el = e.currentTarget;
						setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
					}}
					className="relative min-h-0 flex-1 overflow-y-auto"
				>
					<div className="mx-auto max-w-3xl space-y-8 px-6 pt-6 pb-10">
						{view?.nextCursor ? (
							<div className="flex justify-center">
								<button
									type="button"
									disabled={loadingEarlier}
									onClick={() => {
										setLoadingEarlier(true);
										setPinned(false);
										void loadEarlier(id).finally(() => setLoadingEarlier(false));
									}}
									className="rounded-full border border-line px-3 py-1 text-[13px] text-muted hover:bg-hover hover:text-ink"
								>
									{loadingEarlier ? "Loading…" : "Load earlier messages"}
								</button>
							</div>
						) : null}
						{failure ? (
							<div className="flex items-center gap-2 rounded-[var(--kc-radius)] border border-danger/30 bg-del-bg px-3 py-2 text-danger">
								<CircleAlert size={14} />{" "}
								{deleted ? "The worktree of this chat was deleted. Restore it to continue." : failure.message}
								{deleted ? (
									<button type="button" className="ml-auto underline" onClick={() => void restoreWorktree(id)}>
										Restore
									</button>
								) : (
									<button type="button" className="ml-auto underline" onClick={() => void openThread(id)}>
										Retry
									</button>
								)}
								{failure.code === "threadLockedElsewhere" ? (
									<button type="button" className="underline" onClick={() => void fork(id)}>
										Fork it
									</button>
								) : null}
							</div>
						) : null}
						{!view && !failure ? <div className="kc-pulse text-faint">Loading…</div> : null}
						{workspace?.mode === "worktree" && workspace.setupFailed ? (
							<div className="flex items-center gap-2 rounded-[var(--kc-radius)] border border-line px-3 py-2 text-muted">
								<CircleAlert size={14} /> The environment's setup script failed; the worktree is ready without it.
							</div>
						) : null}
						{progress && view?.turns.length === 0 ? (
							<pre className="max-h-48 overflow-auto rounded-[var(--kc-radius)] bg-sidebar px-3 py-2 font-code text-[12px] text-muted">
								{progress}
							</pre>
						) : null}
						{view?.turns.map((turn) => (
							<TurnView key={turn.id} turn={turn} retry={turn.status === "inProgress" ? view.retry : undefined} />
						))}
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
				{!pinned ? (
					<div className="relative">
						<button
							type="button"
							onClick={() => setPinned(true)}
							className="absolute -top-12 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-elevated px-3 py-1 text-[12px] text-muted shadow hover:text-ink"
						>
							<ArrowDown size={12} /> Jump to latest
						</button>
					</div>
				) : null}
				{/* A request takes the composer's place, as in Codex; the composer stays mounted so a draft survives. */}
				{view?.approvals[0] ? (
					<ApprovalCard key={String(view.approvals[0].id)} threadId={id} approval={view.approvals[0]} cwd={cwd} />
				) : null}
				<div className={view?.approvals[0] ? "hidden" : undefined}>
					<Composer threadId={id} />
				</div>
			</div>
			{panelOpen && view ? <SidePanel id={id} /> : null}
		</div>
	);
}
