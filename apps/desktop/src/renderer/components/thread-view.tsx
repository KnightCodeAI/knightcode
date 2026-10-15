/**
 * One thread (desktop-shell.md section 9.3): a header with the thread menu, the transcript that sticks
 * to the bottom while streaming, older history on demand, approvals and the composer.
 */

import { ArrowDown, CircleAlert, Folder, MoreHorizontal } from "lucide-react";
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
	send,
	transcriptMarkdown,
	useStore,
} from "../store.ts";
import { ApprovalCard } from "./approval.tsx";
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

export function ThreadView({ id }: { id: string }) {
	const view = useStore((s) => s.held[id]);
	const failure = useStore((s) => s.opening[id]);
	const summary = useStore((s) => s.threads.find((t) => t.id === id));
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

	const name = view?.thread.name || summary?.name || "Untitled";
	const cwd = view?.thread.cwd ?? summary?.cwd ?? "";
	const commitRename = () => {
		const value = renaming?.trim();
		setRenaming(undefined);
		if (value && value !== name) void rename(id, value);
	};

	return (
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
				<Folder size={16} className="shrink-0 text-muted" />
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
							<CircleAlert size={14} /> {failure}
							<button type="button" className="ml-auto underline" onClick={() => void openThread(id)}>
								Retry
							</button>
							{failure.includes("another KnightCode") ? (
								<button type="button" className="underline" onClick={() => void fork(id)}>
									Fork it
								</button>
							) : null}
						</div>
					) : null}
					{!view && !failure ? <div className="kc-pulse text-faint">Loading…</div> : null}
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
	);
}
