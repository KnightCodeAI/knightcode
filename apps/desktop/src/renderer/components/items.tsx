/**
 * Transcript rendering (desktop-shell.md section 9.3): a completed turn shows its user message, a
 * quiet "Worked for" row that expands to the work, and the final reply. A running turn shows its
 * work as it happens.
 */

import {
	ChevronRight,
	CircleAlert,
	FileText,
	Search,
	SquareTerminal,
	Pencil,
	Wrench,
	Brain,
	Layers,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ToolOutput } from "@knightcode/app-server-protocol";
import { duration } from "../format.ts";
import type { ViewItem, ViewTurn } from "../store.ts";
import { Markdown } from "./markdown.tsx";

type ToolItem = Extract<ViewItem, { type: "toolCall" }>;

const outputText = (output: ToolOutput[]) =>
	output
		.filter((o): o is Extract<ToolOutput, { type: "text" }> => o.type === "text")
		.map((o) => o.text)
		.join("");

const str = (value: unknown) => (typeof value === "string" ? value : "");
const inputOf = (item: ToolItem) => (item.input ?? {}) as Record<string, unknown>;

function shortPath(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}

/** One line naming what a call did, by tool (section 9.3 table). */
function toolSummary(item: ToolItem): { icon: ReactNode; text: ReactNode } {
	const input = inputOf(item);
	const done = item.status !== "pending" && item.status !== "running";
	const path = shortPath(str(input.path) || str(input.file_path));
	switch (item.tool) {
		case "read":
			return {
				icon: <FileText size={14} />,
				text: (
					<>
						{done ? "Read" : "Reading"} <Code>{path}</Code>
					</>
				),
			};
		case "grep":
		case "find":
		case "ls":
		case "glob":
			return {
				icon: <Search size={14} />,
				text: (
					<>
						{done ? "Searched" : "Searching"} {str(input.pattern) ? <Code>{str(input.pattern)}</Code> : null}
						{path ? (
							<>
								{" "}
								in <Code>{path}</Code>
							</>
						) : null}
					</>
				),
			};
		case "bash":
		case "powershell": {
			const command = str(input.command).split("\n")[0] ?? "";
			const took = item.startedAt && item.completedAt ? ` in ${duration(item.completedAt - item.startedAt)}` : "";
			return {
				icon: <SquareTerminal size={14} />,
				text: (
					<>
						{done ? "Ran" : "Running"} <Code>{command.length > 80 ? `${command.slice(0, 80)}…` : command}</Code>
						{done ? <span className="text-faint">{took}</span> : null}
					</>
				),
			};
		}
		case "edit":
		case "write": {
			const diff = item.fileChanges?.map((c) => c.diff ?? "").join("\n") ?? "";
			const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
			const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
			const verb = item.tool === "write" ? (done ? "Wrote" : "Writing") : done ? "Edited" : "Editing";
			return {
				icon: <Pencil size={14} />,
				text: (
					<>
						{verb} <Code>{path}</Code>
						{diff ? (
							<span className="ml-1.5 font-code text-[11px]">
								<span className="text-add">+{added}</span> <span className="text-del">−{removed}</span>
							</span>
						) : null}
					</>
				),
			};
		}
		default: {
			const first = Object.values(input).find((v) => typeof v === "string") as string | undefined;
			return {
				icon: <Wrench size={14} />,
				text: (
					<>
						<span className="font-medium">{item.tool}</span>
						{first ? (
							<span className="ml-1.5 text-faint">{first.length > 60 ? `${first.slice(0, 60)}…` : first}</span>
						) : null}
					</>
				),
			};
		}
	}
}

function Code({ children }: { children: ReactNode }) {
	return <code className="rounded bg-hover px-1 py-px font-code text-[11.5px] text-ink">{children}</code>;
}

function Diff({ diff }: { diff: string }) {
	return (
		<pre className="selectable overflow-x-auto font-code text-[length:var(--kc-size-code)] leading-relaxed">
			{diff.split("\n").map((line, i) => {
				const cls = line.startsWith("@@")
					? "text-faint"
					: line.startsWith("+") && !line.startsWith("+++")
						? "bg-add-bg text-add"
						: line.startsWith("-") && !line.startsWith("---")
							? "bg-del-bg text-del"
							: "text-muted";
				return (
					<div key={i} className={`px-3 ${cls}`}>
						{line || " "}
					</div>
				);
			})}
		</pre>
	);
}

function ToolDetail({ item }: { item: ToolItem }) {
	const input = inputOf(item);
	const out = outputText(item.output);
	if (item.tool === "bash" || item.tool === "powershell")
		return (
			<pre className="selectable max-h-80 overflow-auto p-3 font-code text-[length:var(--kc-size-code)] leading-relaxed text-muted">
				<span className="text-ink">$ {str(input.command)}</span>
				{out ? `\n${out}` : ""}
				{item.status === "failed" ? <span className="text-danger">{out ? "" : "\n"}(failed)</span> : null}
			</pre>
		);
	const diff = item.fileChanges
		?.map((c) => c.diff ?? "")
		.filter(Boolean)
		.join("\n");
	if (diff) return <Diff diff={diff} />;
	return (
		<div className="selectable space-y-2 p-3 font-code text-[length:var(--kc-size-code)]">
			<pre className="overflow-x-auto whitespace-pre-wrap text-muted">{JSON.stringify(item.input, null, 2)}</pre>
			{out ? (
				<pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-line pt-2 text-ink">{out}</pre>
			) : null}
		</div>
	);
}

function ToolRow({ item, nested }: { item: ToolItem; nested: ViewItem[] }) {
	const [open, setOpen] = useState(false);
	const { icon, text } = toolSummary(item);
	const running = item.status === "pending" || item.status === "running";
	const failed = item.status === "failed" || item.status === "declined";
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted hover:bg-hover hover:text-ink"
			>
				<span className={`shrink-0 ${failed ? "text-danger" : running ? "kc-pulse text-accent" : "text-faint"}`}>
					{icon}
				</span>
				<span className="min-w-0 flex-1 truncate">{text}</span>
				{item.status === "declined" ? <span className="text-[11px] text-danger">Declined</span> : null}
				<ChevronRight
					size={14}
					className={`shrink-0 text-faint opacity-0 transition group-hover:opacity-100 ${open ? "rotate-90 opacity-100" : ""}`}
				/>
			</button>
			{open ? (
				<div className="mt-1 mb-2 ml-6 overflow-hidden rounded-[var(--kc-radius)] border border-line bg-shell">
					<ToolDetail item={item} />
				</div>
			) : null}
			{nested.length > 0 ? (
				<div className="ml-5 border-l border-line pl-2">
					{nested.map((child) =>
						child.type === "toolCall" ? <ToolRow key={child.id} item={child} nested={[]} /> : null,
					)}
				</div>
			) : null}
		</div>
	);
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 rounded-md px-1.5 py-1 text-muted hover:bg-hover"
			>
				<Brain size={14} className={streaming ? "kc-pulse text-accent" : "text-faint"} />
				<span>{streaming ? "Thinking" : "Thought"}</span>
				<ChevronRight size={14} className={`text-faint transition ${open ? "rotate-90" : ""}`} />
			</button>
			{open ? <div className="selectable mt-1 mb-2 ml-6 whitespace-pre-wrap text-muted">{text}</div> : null}
		</div>
	);
}

export function UserBubble({
	text,
	images,
	pending,
	failed,
	onRetry,
	onDismiss,
}: {
	text: string;
	images?: { mimeType: string; data: string }[];
	pending?: boolean;
	failed?: string;
	onRetry?: () => void;
	onDismiss?: () => void;
}) {
	return (
		<div className="flex flex-col items-end">
			<div
				className={`selectable max-w-[85%] rounded-2xl bg-bubble px-4 py-2.5 whitespace-pre-wrap ${pending ? "opacity-60" : ""}`}
			>
				{images?.length ? (
					<div className="mb-2 flex flex-wrap gap-2">
						{images.map((image, i) => (
							<img key={i} src={`data:${image.mimeType};base64,${image.data}`} className="max-h-40 rounded-md" alt="" />
						))}
					</div>
				) : null}
				{text}
			</div>
			{failed ? (
				<div className="mt-1 flex items-center gap-2 text-[12px] text-danger">
					<CircleAlert size={12} /> Not sent: {failed}
					<button type="button" className="underline" onClick={onRetry}>
						Retry
					</button>
					<button type="button" className="text-muted underline" onClick={onDismiss}>
						Dismiss
					</button>
				</div>
			) : null}
		</div>
	);
}

/** Work items in order, with nested calls under their parents. */
function WorkItems({ items, streamingId }: { items: ViewItem[]; streamingId?: string }) {
	const nestedOf = (id: string) => items.filter((i) => i.type === "toolCall" && i.parentItemId === id);
	return (
		<div className="space-y-0.5">
			{items.map((item) => {
				if (item.type === "toolCall")
					return item.parentItemId ? null : <ToolRow key={item.id} item={item} nested={nestedOf(item.id)} />;
				if (item.type === "reasoning")
					return <Reasoning key={item.id} text={item.text} streaming={item.id === streamingId} />;
				if (item.type === "agentMessage")
					return (
						<div key={item.id} className="px-1.5 py-1.5">
							<Markdown text={item.text} />
						</div>
					);
				if (item.type === "compaction") return <CompactionDivider key={item.id} />;
				if (item.type === "extensionMessage")
					return (
						<div key={item.id} className="px-1.5 py-1.5">
							<div className="mb-1 text-[11px] font-medium text-accent">{item.extension}</div>
							<Markdown text={item.text} />
						</div>
					);
				if (item.type === "userMessage") return <UserBubble key={item.id} text={item.text} images={item.images} />;
				return null;
			})}
		</div>
	);
}

/** Compaction as a rule across the transcript: it changes what the model sees, so it is never folded away. */
function CompactionDivider() {
	return (
		<div className="flex items-center gap-3 px-1.5 py-1 text-[12px] text-faint">
			<span className="h-px flex-1 bg-line" />
			<span className="flex items-center gap-1.5">
				<Layers size={13} /> Context compacted
			</span>
			<span className="h-px flex-1 bg-line" />
		</div>
	);
}

export function TurnView({
	turn,
	retry,
}: {
	turn: ViewTurn;
	retry?: { attempt: number; maxAttempts: number; delayMs: number; at: number; error: string };
}) {
	const running = turn.status === "inProgress";
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
	return (
		<div className="space-y-3">
			{first?.type === "userMessage" ? <UserBubble text={first.text} images={first.images} /> : null}
			{running ? (
				<>
					<WorkItems items={work} streamingId={streamingId} />
					{retry ? (
						<div className="flex items-center gap-2 px-1.5 text-warning">
							<CircleAlert size={14} /> Retrying (attempt {retry.attempt} of {retry.maxAttempts}): {retry.error}
						</div>
					) : (
						<div className="kc-pulse px-1.5 text-faint">Working…</div>
					)}
				</>
			) : (
				<>
					{work.length > 0 ? (
						<div>
							<button
								type="button"
								onClick={() => setOpen(!open)}
								className="flex items-center gap-1 px-1.5 py-0.5 text-faint hover:text-muted"
							>
								{turn.completedAt ? `Worked for ${duration(turn.completedAt - turn.startedAt)}` : "Worked"}
								<ChevronRight size={14} className={`transition ${open ? "rotate-90" : ""}`} />
							</button>
							{open ? (
								<div className="mt-1 border-l border-line pl-3">
									<WorkItems items={work} />
								</div>
							) : null}
						</div>
					) : null}
					{compactedBefore ? <CompactionDivider /> : null}
					{final?.type === "agentMessage" ? (
						<div className="border-t border-line px-1.5 pt-3">
							<Markdown text={final.text} />
						</div>
					) : null}
					{compactedAfter ? <CompactionDivider /> : null}
					{turn.status === "interrupted" ? <div className="px-1.5 text-faint">Interrupted</div> : null}
					{turn.status === "failed" ? (
						<div className="flex items-start gap-2 rounded-[var(--kc-radius)] border border-danger/30 bg-del-bg px-3 py-2 text-danger">
							<CircleAlert size={14} className="mt-0.5 shrink-0" />
							<span className="selectable">{turn.error?.message ?? "The turn failed."}</span>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
