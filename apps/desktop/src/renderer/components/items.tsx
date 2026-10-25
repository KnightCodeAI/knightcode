/**
 * Transcript rendering (desktop-shell.md section 9.3), laid out as Codex's (measured 2026-10-19). A turn is the
 * user's message (a blue 22px bubble, its time and Copy/Edit on hover), then "Worked for …" over a hairline, which
 * opens to the work, then the final reply, an "Edited N files" card when the turn changed files, and the reply's
 * Copy and time. While a turn runs its work shows as it happens under "Working for …".
 *
 * Work is a column 16px apart: the agent's commentary, reasoning, and tool calls (components/activity.tsx), two or
 * more in a row folded under one summary ("Edited files, ran commands"). While the turn runs, finished calls are
 * hidden and the running one shows in the present tense, as in Codex; a turn with no final reply shows its work open.
 */

import type { TurnFile } from "@knightcode/app-server-protocol";
import { type ReactNode, useEffect, useState } from "react";
import { diffStats, isRunning, liveEntries, type ToolItem, workEntries } from "../activity.ts";
import { client } from "../client.ts";
import { clockTime, duration, messageTime } from "../format.ts";
import { matches } from "../keys.ts";
import {
	errorText,
	fork,
	resendEdited,
	showChanges,
	toast,
	undoTurnEdits,
	useStore,
	type ViewItem,
	type ViewTurn,
} from "../store.ts";
import { ActiveRow, ActivityGroup, ActivityRow, ToolRow } from "./activity.tsx";
import { Button, IconButton } from "./button.tsx";
import { Tooltip } from "./tooltip.tsx";
import {
	Check,
	ChevronRight,
	CircleAlert,
	Copy,
	FileDiff,
	GitBranch,
	Layers,
	MoreHorizontal,
	Pencil,
	RefreshCw,
	Spinner,
	Undo,
} from "./icons.tsx";
import { Markdown } from "./markdown.tsx";
import { type AppItem, McpAppCard } from "./mcp-app.tsx";
import { ViewNode } from "./view.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu.tsx";

function Reasoning({ text, streaming, took }: { text: string; streaming: boolean; took?: number }) {
	const [open, setOpen] = useState(false);
	return (
		<ActivityRow
			label={
				streaming ? <span className="kc-shimmer">Thinking</span> : took ? `Thought for ${duration(took)}` : "Thought"
			}
			open={open}
			onToggle={() => setOpen(!open)}
		>
			{text ? <div className="selectable pt-2 pb-1 text-base whitespace-pre-wrap text-secondary">{text}</div> : null}
		</ActivityRow>
	);
}

/** A row of actions under a message, with its time (Codex's 26px buttons); hidden until hovered unless `shown`. */
function MessageActions({
	time,
	shown,
	align = "start",
	children,
}: {
	time?: number;
	shown?: boolean;
	align?: "start" | "end";
	children: ReactNode;
}) {
	return (
		<div
			className={`flex items-center gap-2 transition-opacity ${align === "end" ? "flex-row-reverse self-end" : "-ms-1"} ${shown ? "" : "opacity-0 group-hover/message:opacity-100 focus-within:opacity-100"}`}
		>
			<div className="flex items-center gap-0.5">{children}</div>
			{time ? <span className="text-xs text-tertiary">{messageTime(time)}</span> : null}
		</div>
	);
}

function CopyMessage({ text, label = "Copy" }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(0);
	// Each copy restarts the 1.5 s "Copied" state; unmounting clears it.
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(0), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<IconButton
			label={copied ? "Copied" : label}
			size="sm"
			className="rounded-md"
			onClick={() => {
				client
					.host("host/clipboard/writeText", { text })
					.then(() => setCopied(Date.now()))
					.catch((e: unknown) => toast(errorText(e), "error"));
			}}
		>
			{copied ? <Check size={16} /> : <Copy size={16} />}
		</IconButton>
	);
}

/** Codex's "More actions" on a reply: "Branch in new chat", a fork of the thread up to the end of this turn. */
function ReplyMenu({ threadId, atItemId }: { threadId: string; atItemId: string }) {
	return (
		<Menu>
			<MenuTrigger>
				<IconButton label="More actions" size="sm" className="rounded-md">
					<MoreHorizontal size={16} />
				</IconButton>
			</MenuTrigger>
			<MenuContent side="top" minWidth={0}>
				<MenuItem icon={<GitBranch />} onSelect={() => void fork(threadId, atItemId)}>
					Branch in new thread
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

export function UserBubble({
	text,
	images,
	time,
	pending,
	failed,
	onRetry,
	onDismiss,
	onEdit,
}: {
	text: string;
	images?: { mimeType: string; data: string }[];
	time?: number;
	pending?: boolean;
	failed?: string;
	onRetry?: () => void;
	onDismiss?: () => void;
	/** Offered on the last message of an idle thread (Codex's Edit message). */
	onEdit?: (text: string) => void;
}) {
	const [editing, setEditing] = useState<string>();
	if (editing !== undefined && onEdit)
		return (
			<div className="flex flex-col items-end">
				<div className="flex w-full max-w-[70%] flex-col gap-2 rounded-composer bg-composer p-3 shadow-[var(--kc-composer-ring)]">
					<textarea
						autoFocus
						aria-label="Edit message"
						value={editing}
						onChange={(e) => setEditing(e.target.value)}
						onKeyDown={(e) => {
							if (matches(e, "desktop.picker.dismiss")) {
								e.preventDefault();
								setEditing(undefined);
							} else if (matches(e, "desktop.composer.send") && editing.trim()) {
								e.preventDefault();
								onEdit(editing.trim());
								setEditing(undefined);
							}
						}}
						rows={Math.min(8, editing.split("\n").length + 1)}
						className="selectable w-full resize-none bg-transparent px-1 text-base leading-[22.75px] text-ink outline-none focus-visible:outline-none"
					/>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" color="secondary" size="md" squircle onClick={() => setEditing(undefined)}>
							Cancel
						</Button>
						<Button
							variant="solid"
							size="md"
							squircle
							disabled={!editing.trim()}
							onClick={() => {
								onEdit(editing.trim());
								setEditing(undefined);
							}}
						>
							Send
						</Button>
					</div>
				</div>
			</div>
		);
	return (
		<div className="group/message flex flex-col items-end gap-1">
			{images?.length ? (
				<div className={`flex max-w-[70%] flex-wrap justify-end gap-2 ${pending ? "opacity-60" : ""}`}>
					{images.map((image, i) => (
						<img
							key={i}
							src={`data:${image.mimeType};base64,${image.data}`}
							className="max-h-40 rounded-xl border border-line object-cover"
							alt=""
						/>
					))}
				</div>
			) : null}
			{text ? (
				<div
					className={`max-w-[70%] rounded-composer bg-bubble px-4 py-2.5 text-base leading-[22.75px] text-bubble-text ${pending ? "opacity-60" : ""}`}
				>
					<Markdown text={text} tone="user" />
				</div>
			) : null}
			{failed ? (
				<div className="flex items-center gap-2 text-xs text-danger-text">
					<CircleAlert size={12} /> Not sent: {failed}
					<Button variant="ghost" color="danger" size="2xs" onClick={onRetry}>
						<RefreshCw size={12} /> Retry
					</Button>
					<Button variant="ghost" color="secondary" size="2xs" onClick={onDismiss}>
						Dismiss
					</Button>
				</div>
			) : pending ? null : (
				<MessageActions time={time} align="end">
					<CopyMessage text={text} label="Copy message" />
					{onEdit ? (
						<IconButton label="Edit message" size="sm" className="rounded-md" onClick={() => setEditing(text)}>
							<Pencil size={16} />
						</IconButton>
					) : null}
				</MessageActions>
			)}
		</div>
	);
}

/**
 * Work in order: commentary, reasoning, and tool calls, consecutive calls folded under one summary. `live` is the
 * running turn's view: finished calls hidden, the running one as Codex's present-tense row.
 */
function WorkItems({
	items,
	streamingId,
	live,
	cwd,
}: {
	items: ViewItem[];
	streamingId?: string;
	live?: boolean;
	cwd: string;
}) {
	const nestedOf = (id: string) => items.filter((i): i is ToolItem => i.type === "toolCall" && i.parentItemId === id);
	const entries = live ? liveEntries(workEntries(items)) : workEntries(items);
	const rows: ReactNode[] = [];
	for (const entry of entries) {
		if (entry.kind === "group") {
			const running = entry.items.findLast(isRunning);
			rows.push(
				live && running ? (
					<ActiveRow key={entry.items[0]!.id} item={running} cwd={cwd} />
				) : (
					<ActivityGroup key={entry.items[0]!.id} items={entry.items} cwd={cwd} nestedOf={nestedOf} />
				),
			);
			continue;
		}
		const item = entry.item;
		if (item.type === "toolCall")
			rows.push(
				live && isRunning(item) ? (
					<ActiveRow key={item.id} item={item} cwd={cwd} />
				) : (
					<ToolRow key={item.id} item={item} cwd={cwd} nested={nestedOf(item.id)} />
				),
			);
		else if (item.type === "reasoning")
			rows.push(
				<Reasoning
					key={item.id}
					text={item.text}
					streaming={item.id === streamingId}
					took={item.startedAt && item.completedAt ? item.completedAt - item.startedAt : undefined}
				/>,
			);
		else if (item.type === "agentMessage") rows.push(<Markdown key={item.id} text={item.text} />);
		else if (item.type === "compaction") rows.push(<CompactionDivider key={item.id} />);
		else if (item.type === "extensionMessage")
			rows.push(
				<div key={item.id}>
					<div className="mb-1 text-xs font-medium text-accent">{item.extension}</div>
					{item.view ? <ViewNode view={item.view} /> : <Markdown text={item.text} />}
				</div>,
			);
		else if (item.type === "userMessage") rows.push(<UserBubble key={item.id} text={item.text} images={item.images} />);
	}
	return <div className="flex flex-col gap-4">{rows}</div>;
}

/** Compaction as a rule across the transcript: it changes what the model sees, so it is never folded away. */
function CompactionDivider() {
	return (
		<div className="flex items-center gap-3 py-1 text-sm text-tertiary">
			<span className="h-px flex-1 bg-line" />
			<span className="flex items-center gap-1.5">
				<Layers size={14} /> Context compacted
			</span>
			<span className="h-px flex-1 bg-line" />
		</div>
	);
}

/** "Working for 12s", counting while the turn runs. */
function useElapsed(since: number, running: boolean): number {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [running]);
	return Math.max(0, now - since);
}

/** Codex's turn header: "Working for …" or "Worked for … ›" over a hairline. */
function WorkedFor({ turn, open, onToggle }: { turn: ViewTurn; open: boolean; onToggle?: () => void }) {
	const running = turn.status === "inProgress";
	const elapsed = useElapsed(turn.startedAt, running);
	const label = running
		? `Working for ${duration(elapsed)}`
		: turn.completedAt
			? `Worked for ${duration(turn.completedAt - turn.startedAt)}`
			: "Worked";
	return (
		<div className="flex flex-col">
			{onToggle ? (
				<button
					type="button"
					aria-expanded={open}
					onClick={onToggle}
					className={`-ms-1 flex w-fit items-center gap-1 rounded-md px-1 text-base ${open ? "text-ink" : "text-tertiary hover:text-secondary"}`}
				>
					{label}
					<ChevronRight
						size={14}
						className={`transition-[rotate] motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
					/>
				</button>
			) : (
				<span className="text-base text-tertiary">{label}</span>
			)}
			<div className="pt-1">
				<div className="border-t border-line" />
			</div>
		</div>
	);
}

/**
 * The files a turn changed, with their totals: the server's before/after comparison of the checkout when it recorded
 * one (net, and covering bash), else the sum of the turn's edit and write patches (outside git, older sessions).
 */
export function editedFiles(turn: ViewTurn): TurnFile[] {
	if (turn.files) return turn.files;
	const files = new Map<string, TurnFile>();
	for (const item of turn.items) {
		if (item.type !== "toolCall" || item.status !== "completed") continue;
		for (const change of item.fileChanges ?? []) {
			const stats = diffStats(change.diff ?? "");
			// Tool paths can be native Windows paths: one key and one separator for the same file either way.
			const path = change.path.replaceAll("\\", "/");
			const prev = files.get(path) ?? { path, additions: 0, deletions: 0 };
			files.set(path, {
				path,
				additions: prev.additions + stats.additions,
				deletions: prev.deletions + stats.deletions,
			});
		}
	}
	return [...files.values()];
}

/**
 * Codex's "Edited N files" card: totals, Undo or Reapply and View changes, then a row per file. `undoable` only for
 * the latest turn once its change record arrived: until then the server's Last Turn is still the turn before.
 */
function EditedFilesCard({
	threadId,
	turnId,
	files,
	undoable,
}: {
	threadId: string;
	turnId: string;
	files: TurnFile[];
	undoable: boolean;
}) {
	const added = files.reduce((n, f) => n + f.additions, 0);
	const removed = files.reduce((n, f) => n + f.deletions, 0);
	const view = () => showChanges(threadId, "lastTurn");
	// As Codex's: Undo turns into Reapply and back, held while a request runs, with a spinner in place of its icon.
	// In the store, so leaving the thread and coming back still offers Reapply.
	const undone = useStore((s) => s.undoneTurns[turnId] === true);
	const [pending, setPending] = useState(false);
	const toggle = () => {
		setPending(true);
		void undoTurnEdits(threadId, turnId, undone).then(() => setPending(false));
	};
	return (
		<div className="overflow-hidden rounded-lg bg-card-soft shadow-[0_0_0_0.5px_var(--kc-border-strong)]">
			<div className="flex items-center gap-2.5 p-3">
				<button
					type="button"
					onClick={view}
					aria-label="View changed files"
					className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
				>
					<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-secondary">
						<FileDiff size={24} />
					</span>
					<span className="flex min-w-0 flex-col">
						<span className="text-base font-medium text-ink">
							Edited {files.length} file{files.length === 1 ? "" : "s"}
						</span>
						<span className="text-sm leading-[19.5px] tabular-nums">
							<span className="text-git-added">+{added}</span> <span className="text-git-deleted">-{removed}</span>
						</span>
					</span>
				</button>
				<div className="flex items-center gap-2">
					{undoable ? (
						<Button variant="ghost" size="md" squircle disabled={pending} onClick={toggle}>
							{undone ? "Reapply" : "Undo"}
							{pending ? (
								<Spinner size={14} className="motion-safe:animate-spin" />
							) : undone ? (
								<RefreshCw size={14} />
							) : (
								<Undo size={14} />
							)}
						</Button>
					) : null}
					<Button variant="surface" size="md" squircle onClick={view}>
						View changes
					</Button>
				</div>
			</div>
			<div className="border-t border-line">
				{files.map((f) => {
					const cut = f.path.lastIndexOf("/");
					return (
						<button
							key={f.path}
							type="button"
							onClick={view}
							className="flex h-9 w-full items-center gap-2 bg-card-row px-3 text-base hover:bg-ghost-hover"
						>
							<Tooltip content={f.path} align="start" overflow>
								<span className="min-w-0 flex-1 truncate text-start">
									{cut >= 0 ? (
										<span className="text-output">{f.path.slice(0, cut).replaceAll("/", " / ")} / </span>
									) : null}
									<span className="text-ink">{f.path.slice(cut + 1)}</span>
								</span>
							</Tooltip>
							<span className="shrink-0 tabular-nums">
								<span className="text-git-added">+{f.additions}</span>{" "}
								<span className="text-git-deleted">-{f.deletions}</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function TurnView({
	turn,
	retry,
	latest,
	threadId,
}: {
	turn: ViewTurn;
	retry?: { attempt: number; maxAttempts: number; delayMs: number; at: number; error: string };
	/** The thread's last turn: its reply actions stay shown, and its edits can be undone. */
	latest: boolean;
	threadId: string;
}) {
	const running = turn.status === "inProgress";
	const idle = useStore((s) => !s.held[threadId]?.turns.some((t) => t.status === "inProgress"));
	const cwd = useStore((s) => s.held[threadId]?.thread.cwd ?? "");
	// An extension may hide the waiting row or name what it waits on (setWorkingVisible, setWorkingMessage).
	const workingVisible = useStore((s) => s.held[threadId]?.ui.workingVisible !== false);
	const workingMessage = useStore((s) => s.held[threadId]?.ui.workingMessage);
	const working = { visible: workingVisible, message: workingMessage };
	const [open, setOpen] = useState(false);
	const first = turn.items.find((i) => i.type === "userMessage");
	const rest = turn.items.filter((i) => i !== first);
	const finalIndex = running ? -1 : rest.findLastIndex((i) => i.type === "agentMessage");
	const final = finalIndex >= 0 ? rest[finalIndex] : undefined;
	// Compactions stay visible: those before the final reply show above it, later ones below.
	const compactedBefore = rest.some((i, n) => i.type === "compaction" && (finalIndex < 0 || n < finalIndex));
	const compactedAfter = finalIndex >= 0 && rest.some((i, n) => i.type === "compaction" && n > finalIndex);
	const work = rest.filter((i) => i !== final && i.type !== "compaction");
	const last = turn.items.at(-1);
	const streamingId =
		running && last && (last.type === "reasoning" || last.type === "agentMessage") ? last.id : undefined;
	const files = running ? [] : editedFiles(turn);
	const apps = turn.items.filter(
		(i): i is AppItem => i.type === "toolCall" && i.mcpApp !== undefined && i.parentItemId === undefined,
	);
	const undoable = latest && turn.files !== undefined;
	// A fork point must be saved, as only indexed items are.
	const forkPoint = turn.items.findLast((i) => i.index !== undefined);
	return (
		<div className="flex flex-col gap-3">
			{first?.type === "userMessage" ? (
				<UserBubble
					text={first.text}
					images={first.images}
					time={turn.startedAt}
					onEdit={latest && idle ? (text) => void resendEdited(threadId, turn.id, text, first.images) : undefined}
				/>
			) : null}
			{running ? (
				<>
					<WorkedFor turn={turn} open />
					<WorkItems items={work} streamingId={streamingId} live cwd={cwd} />
					{retry ? (
						<div className="flex items-center gap-2 text-base text-warning">
							<CircleAlert size={14} /> Retrying (attempt {retry.attempt} of {retry.maxAttempts}): {retry.error}
						</div>
					) : !streamingId && !work.some((i) => i.type === "toolCall" && isRunning(i)) && working.visible ? (
						// Waiting on the model, not on a tool: Codex's shimmering "Thinking", or an extension's working text.
						<span className="kc-shimmer w-fit text-base">{working.message ?? "Thinking"}</span>
					) : null}
				</>
			) : work.length > 0 && !final ? (
				// No reply to fold the work under (a turn that only asked questions).
				<WorkItems items={work} cwd={cwd} />
			) : work.length > 0 ? (
				<div className="flex flex-col gap-4">
					<WorkedFor turn={turn} open={open} onToggle={() => setOpen(!open)} />
					{open ? <WorkItems items={work} cwd={cwd} /> : null}
				</div>
			) : null}
			{/* MCP Apps stay in sight when the work folds, and in one place while the turn runs and after, so the frame
			    is never made again (mcp-app.tsx). */}
			{apps.map((item) => (
				<McpAppCard key={item.id} threadId={threadId} item={item} />
			))}
			{running ? null : (
				<>
					{compactedBefore ? <CompactionDivider /> : null}
					{final?.type === "agentMessage" ? (
						<div className="group/message flex flex-col gap-2">
							<Markdown text={final.text} />
							{files.length > 0 ? (
								<EditedFilesCard threadId={threadId} turnId={turn.id} files={files} undoable={undoable} />
							) : null}
							<MessageActions time={turn.completedAt} shown={latest}>
								<CopyMessage text={final.text} />
								{forkPoint ? <ReplyMenu threadId={threadId} atItemId={forkPoint.id} /> : null}
							</MessageActions>
						</div>
					) : files.length > 0 ? (
						<EditedFilesCard threadId={threadId} turnId={turn.id} files={files} undoable={undoable} />
					) : null}
					{compactedAfter ? <CompactionDivider /> : null}
					{turn.status === "interrupted" ? (
						<div className="text-base text-tertiary">Interrupted · {clockTime(turn.completedAt ?? turn.startedAt)}</div>
					) : null}
					{turn.status === "failed" ? (
						<div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-base text-danger-text">
							<CircleAlert size={14} className="mt-1 shrink-0" />
							<span className="selectable">{turn.error?.message ?? "The turn failed."}</span>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
