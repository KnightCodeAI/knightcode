/**
 * A turn's tool calls, drawn as Codex draws them (measured 2026-10-20; the model is ../activity.ts). A row is a 16px
 * icon and 14px text at 60% that brightens on hover, with a 14px chevron shown on hover or while open; the whole row
 * toggles it. A command opens to Codex's Shell card, an edit to its diff card (@pierre/diffs, unified), questions to
 * their answers. Two or more calls in a row fold under one summary row whose list scrolls past 224px.
 */

import type { FileDiffOptions } from "@pierre/diffs";
import { isHighlighterLoaded } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	activitySummary,
	baseName,
	commandResult,
	type CommandEnd,
	diffStats,
	expandable,
	inputOf,
	isRunning,
	type Kind,
	kindOf,
	kindOfItem,
	outputText,
	patchOf,
	questionsAndAnswers,
	rowLabel,
	summaryKind,
	type ToolItem,
} from "../activity.ts";
import { client } from "../client.ts";
import diffOverrides from "../diff-overrides.css?raw";
import { matches } from "../keys.ts";
import { errorText, selectPreferences, toast, useStore } from "../store.ts";
import { IconButton } from "./button.tsx";
import { highlighterReady, Totals } from "./changes.tsx";
import {
	Check,
	ChevronRight,
	CircleHelp,
	Code,
	Copy,
	FileText,
	Globe,
	ListTodo,
	Pencil,
	SquareTerminal,
	Wrench,
} from "./icons.tsx";
import { Markdown } from "./markdown.tsx";

const ICONS: Record<Kind, typeof Wrench> = {
	command: SquareTerminal,
	explore: FileText,
	edit: Pencil,
	web: Globe,
	loaded: Wrench,
	tools: Wrench,
	question: CircleHelp,
	plan: ListTodo,
};

export function KindIcon({ kind, tool }: { kind: Kind; tool?: string }) {
	const Icon = tool === "codemode" ? Code : ICONS[kind];
	return <Icon size={16} className="shrink-0" />;
}

/** A path the agent named, absolute or relative to the thread's folder. */
const fullPath = (path: string, cwd: string) =>
	/^([a-zA-Z]:)?[\\/]/.test(path) ? path : `${cwd.replace(/[\\/]+$/, "")}/${path}`;

/** A file named in a row: Codex's link, at half strength and underlined, opening the file. */
function FileLink({ path, cwd, children }: { path: string; cwd: string; children: ReactNode }) {
	return (
		<button
			type="button"
			className="pointer-events-auto min-w-0 truncate text-tertiary underline decoration-current/40 underline-offset-2 hover:text-ink"
			onClick={() =>
				void client
					.host("host/shell/openPath", { path: fullPath(path, cwd) })
					.catch((e: unknown) => toast(errorText(e), "error"))
			}
		>
			{children}
		</button>
	);
}

/**
 * Codex's activity header: the icon and words at 60% (all of them, white on hover), the chevron shown on hover, on
 * focus or while open. Without `onToggle` the row only reads; `active` shimmers it while the call runs.
 */
export function ActivityRow({
	icon,
	label,
	open = false,
	onToggle,
	active,
	children,
}: {
	icon?: ReactNode;
	label: ReactNode;
	open?: boolean;
	onToggle?: () => void;
	active?: boolean;
	children?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col">
			<div className="group/activity relative inline-flex max-w-full min-w-0 items-center gap-1 self-start text-base">
				{onToggle ? (
					<button
						type="button"
						aria-expanded={open}
						onClick={onToggle}
						className="absolute inset-0 rounded-md focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
					/>
				) : null}
				<span className="pointer-events-none relative flex min-w-0 items-center gap-1.5 text-activity group-hover/activity:text-ink">
					{icon}
					<span className={`flex min-w-0 items-center truncate ${active ? "kc-shimmer" : ""}`}>{label}</span>
				</span>
				{onToggle ? (
					<ChevronRight
						size={14}
						className={`pointer-events-none relative shrink-0 text-activity transition-[opacity,rotate] motion-reduce:transition-none ${open ? "rotate-90" : "opacity-0 group-hover/activity:opacity-100 group-has-[:focus-visible]/activity:opacity-100"}`}
					/>
				) : null}
			</div>
			{open ? children : null}
		</div>
	);
}

/** A row's words: the text, a file link, and an edit's totals, coloured on hover as Codex's. */
function Label({ item, cwd, open }: { item: ToolItem; cwd: string; open: boolean }) {
	const label = rowLabel(item, cwd, open);
	return (
		<>
			<span className="truncate">{label.text}</span>
			{label.path ? (
				<>
					&nbsp;
					<FileLink path={label.target ?? label.path} cwd={cwd}>
						{label.path}
					</FileLink>
				</>
			) : null}
			{label.stats ? (
				<span className="ms-1.5 inline-flex shrink-0 items-center gap-1 text-sm leading-none tracking-tight tabular-nums">
					<span className="group-hover/activity:text-git-added">+{label.stats.additions}</span>
					<span className="group-hover/activity:text-git-deleted">-{label.stats.deletions}</span>
				</span>
			) : null}
		</>
	);
}

/** Codex's 24px copy button; `className` places it and shows it while its block is hovered. */
function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<IconButton
			label={copied ? "Copied" : label}
			size="xs"
			className={`transition-opacity focus-visible:opacity-100 ${className}`}
			onClick={() => {
				void client.host("host/clipboard/writeText", { text });
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
		>
			{copied ? <Check size={14} /> : <Copy size={14} />}
		</IconButton>
	);
}

const END_TEXT: Record<CommandEnd["kind"], string> = {
	running: "",
	success: "Success",
	exit: "",
	stopped: "Stopped",
	declined: "Declined",
	failed: "",
};

/**
 * Codex's Shell card: a #fff/8% card with a 15.7% hairline; "Shell"; the command after a `$`, two lines until
 * pressed; its output anchored to its end in a 144px scroll that fades at the edges, "No output" when there is none;
 * and how it ended at the bottom right.
 */
export function TerminalCard({
	title,
	command,
	prompt = "$",
	output,
	end,
}: {
	title: string;
	command: string;
	prompt?: string;
	output: string;
	end: CommandEnd;
}) {
	const [full, setFull] = useState(false);
	const ended = end.kind === "exit" ? `Exit code ${end.code}` : end.kind === "failed" ? end.text : END_TEXT[end.kind];
	return (
		<div className="flex flex-col gap-2 pt-2 pb-1">
			<div className="flex flex-col overflow-hidden rounded-lg border border-line-strong bg-ghost-hover">
				<div className="flex items-center gap-2 px-2 py-1 text-sm text-output select-none">{title}</div>
				{command ? (
					<div className="px-2 pt-2">
						<div className="group/command relative pe-6">
							<div
								role="button"
								tabIndex={0}
								aria-label={`${prompt} ${command}`}
								onClick={() => setFull(true)}
								onKeyDown={(e) => {
									if (matches(e, "desktop.item.activate")) {
										e.preventDefault();
										setFull(true);
									}
								}}
								className={`selectable rounded-md font-code text-sm leading-[19.5px] break-words whitespace-pre-wrap text-output focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${full ? "" : "line-clamp-2"}`}
							>
								{prompt ? <span className="me-[1ch] text-tertiary">{prompt}</span> : null}
								{command}
							</div>
							<CopyButton
								text={command}
								label="Copy command"
								className="absolute top-0 right-0 opacity-0 group-hover/command:opacity-100"
							/>
						</div>
					</div>
				) : null}
				<div className="group/output relative min-h-5">
					<div className="kc-scroll-fade flex max-h-36 flex-col-reverse overflow-auto font-code text-sm leading-[19.5px] font-medium whitespace-pre text-output [--kc-fade-edge:2rem] [animation-direction:reverse]">
						<div className="selectable w-max min-w-full p-2">
							{output || (end.kind === "running" ? "" : <span className="text-tertiary opacity-80">No output</span>)}
						</div>
					</div>
					{output ? (
						<CopyButton
							text={output}
							label="Copy output"
							className="absolute top-0 right-2.5 opacity-0 group-hover/output:opacity-100"
						/>
					) : null}
				</div>
				<div className="flex items-center gap-2 px-2.5 pt-0.5 pb-1 text-base text-tertiary">
					{ended ? (
						<span className="ms-auto flex items-center gap-1">
							{end.kind === "success" ? <Check size={14} /> : null}
							{ended}
						</span>
					) : null}
				</div>
			</div>
		</div>
	);
}

/** Wait for the shared highlighter: a diff first drawn before it loads stays blank (changes.tsx). */
function useHighlighter(): boolean {
	const [ready, setReady] = useState(isHighlighterLoaded);
	useEffect(() => {
		if (!ready) void highlighterReady.then(() => setReady(true));
	}, [ready]);
	return ready;
}

/**
 * Codex's diff card under an opened edit: a hairline card, a header with the file (opening it), its totals and Copy,
 * then the unified diff on the tertiary surface in a 240px scroll.
 */
function DiffCard({ item, cwd }: { item: ToolItem; cwd: string }) {
	const change = item.fileChanges?.[0];
	const patch = patchOf(item);
	const ready = useHighlighter();
	const themeType = useStore((s) => s.resolvedTheme);
	const indicators = useStore((s) => selectPreferences(s).diffMarkers) === "plusMinus" ? "classic" : "bars";
	const options = useMemo<FileDiffOptions<undefined, undefined>>(
		() => ({
			theme: { dark: "pierre-dark", light: "pierre-light" },
			themeType,
			diffStyle: "unified",
			diffIndicators: indicators,
			overflow: "scroll",
			hunkSeparators: "line-info",
			lineDiffType: "word-alt",
			disableFileHeader: true,
			unsafeCSS: diffOverrides,
		}),
		[themeType, indicators],
	);
	if (!change || !patch) return null;
	const stats = diffStats(patch);
	// @pierre/diffs reads a git patch; the tools write a plain unified one.
	const gitPatch = patch.startsWith("diff --git") ? patch : `diff --git a/${change.path} b/${change.path}\n${patch}\n`;
	return (
		<div className="mt-1.5 flex flex-col overflow-hidden rounded-lg border border-line">
			<div className="flex items-center justify-between gap-2 border-b border-line bg-ghost-hover/60 px-2.5 py-0.5 text-sm leading-[19.5px] text-output/80">
				<div className="flex min-w-0 items-center gap-2 py-px">
					<button
						type="button"
						className="min-w-0 truncate hover:text-ink"
						onClick={() =>
							void client
								.host("host/shell/openPath", { path: fullPath(change.path, cwd) })
								.catch((e: unknown) => toast(errorText(e), "error"))
						}
					>
						{baseName(change.path)}
					</button>
					<Totals additions={stats.additions} deletions={stats.deletions} className="text-sm" />
				</div>
				<CopyButton text={patch} label="Copy" className="shrink-0" />
			</div>
			<div className="kc-inline-diff bg-surface-tertiary">
				<div className="max-h-60 overflow-y-auto">
					{ready ? <PatchDiff patch={gitPatch} disableWorkerPool options={options} /> : null}
				</div>
			</div>
		</div>
	);
}

/** Output with no card of its own (a failed read, a tool's result): the Shell card's body, titled for the tool. */
function OutputCard({ item }: { item: ToolItem }) {
	const kind = kindOf(item.tool);
	const input = JSON.stringify(item.input ?? {}, null, 2);
	const title = item.tool === "codemode" ? "Code" : kind === "tools" || kind === "loaded" ? item.tool : "Output";
	const end: CommandEnd = isRunning(item)
		? { kind: "running" }
		: item.status === "completed"
			? { kind: "success" }
			: item.status === "declined"
				? { kind: "declined" }
				: { kind: "failed", text: "Failed" };
	// A read, search or edit that failed shows only why; a tool shows what it was called with.
	const command =
		item.tool === "codemode"
			? String(inputOf(item).code ?? "")
			: kind === "explore" || kind === "web" || kind === "edit"
				? ""
				: input;
	return <TerminalCard title={title} command={command} prompt="" output={outputText(item.output)} end={end} />;
}

/** Codex's answered questions: each question at 60%, its answer under it at 30%. */
function QuestionsBody({ item }: { item: ToolItem }) {
	return (
		<div className="mt-1.5 flex flex-col gap-3 pt-1 pb-0.5">
			{questionsAndAnswers(item).map((qa, i) => (
				<div key={i} className="flex flex-col gap-1">
					<span className="selectable text-base whitespace-pre-wrap text-activity">{qa.question}</span>
					<span className="selectable text-base whitespace-pre-wrap text-ink/30">
						{qa.answer ?? "No answer provided"}
					</span>
				</div>
			))}
		</div>
	);
}

function ToolBody({ item, cwd, nested }: { item: ToolItem; cwd: string; nested: ToolItem[] }) {
	const kind = kindOf(item.tool);
	let body: ReactNode;
	if (kind === "command") {
		const { output, end } = commandResult(item);
		body = <TerminalCard title="Shell" command={String(inputOf(item).command ?? "")} output={output} end={end} />;
	} else if (kind === "edit" && patchOf(item)) body = <DiffCard item={item} cwd={cwd} />;
	else if (kind === "question") body = <QuestionsBody item={item} />;
	else if (kind === "plan")
		body = (
			<div className="mt-1.5 rounded-lg border border-line px-4 py-3">
				<Markdown text={String(inputOf(item).markdown ?? "")} />
			</div>
		);
	else body = <OutputCard item={item} />;
	return (
		<>
			{body}
			{nested.length ? (
				<div className="flex flex-col">
					{nested.map((child) => (
						<div key={child.id} className="pt-1">
							<ToolRow item={child} cwd={cwd} nested={[]} />
						</div>
					))}
				</div>
			) : null}
		</>
	);
}

export function ToolRow({ item, cwd, nested }: { item: ToolItem; cwd: string; nested: ToolItem[] }) {
	const [open, setOpen] = useState(false);
	const toggle = expandable(item) || nested.length > 0 ? () => setOpen(!open) : undefined;
	return (
		<ActivityRow
			icon={<KindIcon kind={kindOfItem(item)} tool={item.tool} />}
			label={<Label item={item} cwd={cwd} open={open} />}
			open={open}
			onToggle={toggle}
		>
			<ToolBody item={item} cwd={cwd} nested={nested} />
		</ActivityRow>
	);
}

/** Codex's summary row over two or more calls; open, the calls 4px apart in a list that scrolls past 224px. */
export function ActivityGroup({
	items,
	cwd,
	nestedOf,
}: {
	items: ToolItem[];
	cwd: string;
	nestedOf: (id: string) => ToolItem[];
}) {
	const [open, setOpen] = useState(false);
	return (
		<ActivityRow
			icon={<KindIcon kind={summaryKind(items)} />}
			label={<span className="truncate">{activitySummary(items)}</span>}
			open={open}
			onToggle={() => setOpen(!open)}
		>
			<div className="-ms-2 ps-2">
				<div className="kc-scroll-fade -ms-2 flex max-h-56 flex-col overflow-x-hidden overflow-y-auto ps-2">
					{items.map((item) => (
						<div key={item.id} className="pt-1">
							<ToolRow item={item} cwd={cwd} nested={nestedOf(item.id)} />
						</div>
					))}
				</div>
			</div>
		</ActivityRow>
	);
}

/** While a turn runs, Codex shows only the call in progress: its row in the present tense, shimmering. */
export function ActiveRow({ item, cwd }: { item: ToolItem; cwd: string }) {
	const label = rowLabel(item, cwd);
	return (
		<ActivityRow
			icon={<KindIcon kind={kindOfItem(item)} tool={item.tool} />}
			label={<span className="truncate">{label.path ? `${label.text} ${label.path}` : label.text}</span>}
			active
		/>
	);
}
