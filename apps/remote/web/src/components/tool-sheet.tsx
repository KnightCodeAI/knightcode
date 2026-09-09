import {
	ChevronLeft,
	FilePenLine,
	FilePlus2,
	FileText,
	Folder,
	Loader2,
	type LucideIcon,
	Search,
	Terminal,
	Wrench,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { GlassButton } from "@/components/glass";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { shortenPath } from "@/lib/api";
import { describeTool, diffStats, groupStats, isRunning, kindOf, outputOf, summariseTools, type ToolKind } from "@/lib/tools";
import type { ToolCallView } from "@/lib/transcript";
import { cn } from "@/lib/utils";

/** File tools show the last two path segments in the list; the full path waits in the detail. */
function isPath(kind: ToolKind): boolean {
	return kind === "write" || kind === "edit" || kind === "read" || kind === "list";
}

const ICONS: Record<ToolKind, LucideIcon> = {
	shell: Terminal,
	write: FilePlus2,
	edit: FilePenLine,
	read: FileText,
	search: Search,
	list: Folder,
	other: Wrench,
};

export function ToolIcon({ kind, className }: { kind: ToolKind; className?: string }): React.JSX.Element {
	const Icon = ICONS[kind];
	return <Icon className={cn("size-5", className)} strokeWidth={1.75} aria-hidden="true" />;
}

export function Stats({ added, removed, className }: { added: number; removed: number; className?: string }) {
	if (added === 0 && removed === 0) return null;
	return (
		<span className={cn("flex-none font-mono text-[13px] tabular-nums", className)}>
			<span className="text-added">+{added}</span> <span className="text-removed">−{removed}</span>
		</span>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
	return (
		<section className="mb-5">
			<h3 className="mb-2 text-[15px] font-medium text-label-2">{title}</h3>
			{children}
		</section>
	);
}

function Mono({ text, wrap = false, className }: { text: string; wrap?: boolean; className?: string }) {
	return <pre className={cn("mono-block", wrap && "whitespace-pre-wrap break-words", className)}>{text}</pre>;
}

function DiffLines({ diff }: { diff: string }): React.JSX.Element {
	return (
		<pre className="mono-block px-0">
			{diff.split("\n").map((line, index) => {
				const added = /^\+\s*\d+ /.test(line);
				const removed = /^-\s*\d+ /.test(line);
				const context = /^ \s*\d+ /.test(line);
				return (
					<span
						key={index}
						className={cn("diff-line", added && "diff-add", removed && "diff-del", !added && !removed && !context && "diff-skip")}
					>
						{line || " "}
					</span>
				);
			})}
		</pre>
	);
}

function AddedLines({ text }: { text: string }): React.JSX.Element {
	return (
		<pre className="mono-block px-0">
			{text.split("\n").map((line, index) => (
				<span key={index} className="diff-line diff-add">
					+ {line}
				</span>
			))}
		</pre>
	);
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function Output({ call }: { call: ToolCallView }): React.JSX.Element {
	if (isRunning(call)) {
		return (
			<p className="flex items-center gap-2 text-[15px] text-label-2">
				<Loader2 className="size-4 animate-spin" aria-hidden="true" /> Running…
			</p>
		);
	}
	const text = outputOf(call);
	if (text.trim().length === 0) return <p className="text-[15px] text-label-3">No output</p>;
	return <Mono text={text} />;
}

function Detail({ call }: { call: ToolCallView }): React.JSX.Element {
	const kind = kindOf(call.name);
	const args = call.args;
	switch (kind) {
		case "shell":
			return (
				<>
					<Section title="Command">
						<Mono text={str(args.command)} wrap />
					</Section>
					<Section title="Output">
						<Output call={call} />
					</Section>
				</>
			);
		case "write":
			return (
				<>
					<Section title="File">
						<Mono text={str(args.path)} wrap />
					</Section>
					<Section title="Content">
						<AddedLines text={str(args.content)} />
					</Section>
					{call.result?.isError ? (
						<Section title="Error">
							<Output call={call} />
						</Section>
					) : null}
				</>
			);
		case "edit": {
			const diff = (call.result?.details as { diff?: unknown } | undefined)?.diff;
			const edits = Array.isArray(args.edits) ? (args.edits as Array<Record<string, unknown>>) : [];
			return (
				<>
					<Section title="File">
						<Mono text={str(args.path)} wrap />
					</Section>
					{typeof diff === "string" ? (
						<Section title="Changes">
							<DiffLines diff={diff} />
						</Section>
					) : (
						<Section title={call.result?.isError ? "Attempted" : "Changes"}>
							{(edits.length > 0 ? edits : [args]).map((edit, index) => (
								<div key={index} className="mb-3">
									<pre className="mono-block px-0">
										{str(edit.oldText)
											.split("\n")
											.map((line, lineIndex) => (
												<span key={`o${lineIndex}`} className="diff-line diff-del">
													- {line}
												</span>
											))}
										{str(edit.newText)
											.split("\n")
											.map((line, lineIndex) => (
												<span key={`n${lineIndex}`} className="diff-line diff-add">
													+ {line}
												</span>
											))}
									</pre>
								</div>
							))}
						</Section>
					)}
					{call.result?.isError ? (
						<Section title="Error">
							<Output call={call} />
						</Section>
					) : null}
				</>
			);
		}
		case "read":
			return (
				<>
					<Section title="File">
						<Mono
							text={`${str(args.path)}${typeof args.offset === "number" ? `  from line ${args.offset}` : ""}${typeof args.limit === "number" ? `  (${args.limit} lines)` : ""}`}
							wrap
						/>
					</Section>
					<Section title="Content">
						<Output call={call} />
					</Section>
				</>
			);
		default:
			return (
				<>
					<Section title="Arguments">
						<Mono text={JSON.stringify(args, null, 2)} wrap />
					</Section>
					<Section title="Output">
						<Output call={call} />
					</Section>
				</>
			);
	}
}

function Row({ call, onOpen }: { call: ToolCallView; onOpen(): void }): React.JSX.Element {
	const description = describeTool(call);
	const stats = diffStats(call);
	return (
		<li className="timeline-row relative">
			<button
				type="button"
				onClick={onOpen}
				className="flex w-full items-center gap-3.5 rounded-xl py-2.5 pr-1 text-left active:bg-raised"
			>
				<span className="flex size-6 flex-none items-center justify-center text-label">
					{isRunning(call) ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <ToolIcon kind={description.kind} />}
				</span>
				<span className="min-w-0 flex-1 truncate text-[17px]">
					<span className="text-label">{description.verb}</span>{" "}
					<span className={cn("text-label-2", description.kind !== "other" && "font-mono text-[15px]")}>
						{isPath(description.kind) ? (shortenPath(description.subject) ?? description.subject) : description.subject}
					</span>
				</span>
				{call.result?.isError ? <span className="flex-none text-[13px] text-danger">Failed</span> : null}
				<Stats added={stats.added} removed={stats.removed} />
			</button>
		</li>
	);
}

/**
 * One sheet, two views: the group's calls on a timeline, then a single call's detail. The
 * selection resets whenever a different group is opened.
 */
export function ToolSheet({ calls, onClose }: { calls?: ToolCallView[]; onClose(): void }): React.JSX.Element {
	const [selectedId, setSelectedId] = useState<string>();
	useEffect(() => setSelectedId(undefined), [calls]);
	const selected = calls?.find((call) => call.id === selectedId);
	const stats = calls ? groupStats(calls) : { added: 0, removed: 0 };

	return (
		<Sheet open={calls !== undefined} onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				side="bottom"
				showCloseButton={false}
				className="glass-strong gap-0 rounded-t-[1.75rem] border-b-0 p-0 text-label data-[side=bottom]:max-h-[88dvh] data-[side=bottom]:min-h-[48dvh]"
				style={{ paddingBottom: "var(--safe-bottom)" }}
			>
				<div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-label-3/60" aria-hidden="true" />
				<div className="flex flex-none items-center gap-3 px-4 pt-3 pb-2">
					{selected ? (
						<GlassButton aria-label="Back to the list" onClick={() => setSelectedId(undefined)}>
							<ChevronLeft className="size-6" aria-hidden="true" />
						</GlassButton>
					) : (
						<GlassButton aria-label="Close" onClick={onClose}>
							<X className="size-5" aria-hidden="true" />
						</GlassButton>
					)}
					<div className="min-w-0 flex-1">
						<SheetTitle className={cn("truncate text-[19px] font-semibold text-label", selected && "text-center")}>
							{selected ? selected.name : calls ? summariseTools(calls) : ""}
						</SheetTitle>
						<SheetDescription className="sr-only">Tool calls from this part of the session</SheetDescription>
					</div>
					{selected ? <span className="w-11 flex-none" /> : <Stats added={stats.added} removed={stats.removed} />}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
					{selected ? (
						<div className="pt-2">
							<Detail call={selected} />
						</div>
					) : (
						<ol className="py-1">
							{calls?.map((call) => (
								<Row key={call.id} call={call} onOpen={() => setSelectedId(call.id)} />
							))}
						</ol>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
