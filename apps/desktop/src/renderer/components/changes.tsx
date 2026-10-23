/**
 * The Changes pane (desktop-shell.md section 9.6), shaped after Codex's: a source capsule with totals and a
 * controls capsule, each file under a sticky header with its diff (@pierre/diffs, as Codex renders it), review
 * comments from the gutter, and a file tree on the right.
 */

import type { DiffComment, DiffFile, DiffScope, ResultOf } from "@knightcode/app-server-protocol";
import {
	type FileDiffContentsLoader,
	type FileDiffOptions,
	isHighlighterLoaded,
	preloadHighlighter,
	type SelectedLineRange,
} from "@pierre/diffs";
import { type DiffLineAnnotation, PatchDiff } from "@pierre/diffs/react";
import { prepareFileTreeInput } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clipboard,
	CollapseAll,
	Columns2,
	ExpandAll,
	ExternalLink,
	Eye,
	File,
	FileDiff,
	FileSearch,
	Folders,
	Info,
	MoreHorizontal,
	RefreshCw,
	Rows2,
	Search,
	WrapText,
} from "./icons.tsx";
import type React from "react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client, RequestError } from "../client.ts";
import diffOverrides from "../diff-overrides.css?raw";
import { isLargeDiff } from "../format.ts";
import { matches } from "../keys.ts";
import {
	addComment,
	errorText,
	getState,
	openFileTab,
	removeComment,
	selectPreferences,
	setPanel,
	toast,
	useStore,
} from "../store.ts";
import { openIn, useOpenInTargets, usePreferredTarget } from "./open-in.tsx";
import { Button, type ButtonProps, IconButton } from "./button.tsx";
import { Tooltip } from "./tooltip.tsx";
import { FileIcon } from "./file-icon.tsx";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuTrigger,
} from "./menu.tsx";
import { followDrag } from "../drag.ts";

type Selector = { scope: DiffScope; against?: string; commit?: string };
type Read = ResultOf<"thread/diff/read">;
const NONE: ReadonlySet<string> = new Set();

/** A file's first changed line on the new side, past its first hunk's context, as tool rows open files. */
function firstChange(file: DiffFile): number | undefined {
	const hunk = file.hunks[0];
	if (!hunk) return undefined;
	const context = hunk.lines.findIndex((line) => !line.startsWith(" "));
	return Math.max(1, hunk.newStart + Math.max(0, context));
}

const SCOPES: { scope: DiffScope; label: string }[] = [
	{ scope: "lastTurn", label: "Last Turn" },
	{ scope: "uncommitted", label: "Uncommitted" },
	{ scope: "unstaged", label: "Unstaged" },
	{ scope: "staged", label: "Staged" },
	{ scope: "committed", label: "Committed" },
	{ scope: "branch", label: "Branch" },
];

/** The unified patch @pierre/diffs parses, rebuilt from the server's hunks. */
export function patchOf(file: DiffFile): string {
	const oldPath = file.oldPath ?? file.path;
	return [
		`diff --git a/${oldPath} b/${file.path}`,
		`--- ${file.status === "added" ? "/dev/null" : `a/${oldPath}`}`,
		`+++ ${file.status === "deleted" ? "/dev/null" : `b/${file.path}`}`,
		...file.hunks.flatMap((hunk) => [hunk.header, ...hunk.lines]),
		"",
	].join("\n");
}

/** +added −deleted, as Codex prints them: tabular, tight, its git colors. */
export function Totals({
	additions,
	deletions,
	className = "",
}: {
	additions: number;
	deletions: number;
	className?: string;
}) {
	return (
		<span className={`inline-flex items-center gap-1 leading-none tracking-[-0.35px] tabular-nums ${className}`}>
			<span className="text-git-added">+{additions}</span>
			<span className="text-git-deleted">-{deletions}</span>
		</span>
	);
}

/** Codex's control capsule: a pill holding buttons, a hairline ring and a soft shadow. */
function Capsule({ children, label }: { children: ReactNode; label: string }) {
	return (
		<div
			role="group"
			aria-label={label}
			className="kc-capsule inline-flex min-w-0 items-center gap-0.5 rounded-full p-0.5"
		>
			{children}
		</div>
	);
}

/** A button in the controls capsule (Codex's 28px round ghost); a pressed toggle turns Codex's blue. */
function ControlButton({
	label,
	pressed,
	children,
	...props
}: { label: string; pressed?: boolean; children: ReactNode } & Omit<ButtonProps, "children" | "color">) {
	return (
		<IconButton label={label} round toggle aria-pressed={pressed} {...props}>
			{children}
		</IconButton>
	);
}

/** A pane narrower than this folds Refresh, Word wrap, the layout switch and Collapse all into ⋯, as Codex's does. */
const COMPACT_WIDTH = 720;

/** The element's width, kept current as it resizes. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

const TREE_MIN = 200;
/** The most of the pane the file tree takes, while dragged or not (styles.css, .kc-tree-slot); the diff keeps the rest. */
const TREE_MAX_SHARE = 0.6;

/**
 * The file tree's left edge: a handle that drags its width between 200px and 60% of the pane (Codex's). Dragging it
 * under half the minimum hides it, and dragging back shows it again.
 */
function TreeResizeHandle({
	width,
	onWidth,
	onOpen,
}: {
	width: number;
	onWidth: (width: number) => void;
	onOpen: (open: boolean) => void;
}) {
	const start = (event: React.PointerEvent) => {
		event.preventDefault();
		const from = event.clientX;
		const tree = event.currentTarget.parentElement!;
		const initial = tree.getBoundingClientRect().width;
		// The pane's row, past the tree's slot (.kc-tree-slot), which is only as wide as the tree.
		const row = tree.parentElement!.parentElement!;
		const max = Math.max(TREE_MIN, row.getBoundingClientRect().width * TREE_MAX_SHARE);
		let open = true;
		const onMove = (e: PointerEvent) => {
			const size = initial - (e.clientX - from);
			if (size >= TREE_MIN / 2 !== open) {
				open = !open;
				onOpen(open);
			}
			if (open) onWidth(Math.max(TREE_MIN, Math.min(size, max)));
		};
		followDrag(onMove);
	};
	return (
		<div
			onPointerDown={start}
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize file tree"
			aria-valuenow={width}
			aria-valuemin={TREE_MIN}
			className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize"
		/>
	);
}

const sum = (files: DiffFile[], key: "additions" | "deletions") => files.reduce((n, f) => n + f[key], 0);
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const scopeOf = (c: DiffComment) => c.scope ?? "uncommitted";

/** The draft comment editor or a saved comment, in the diff under its line (Codex's "Local comment on line R6"). */
function CommentCard({
	line,
	side,
	body,
	onSave,
	onCancel,
	onDelete,
}: {
	line: number;
	side: "old" | "new";
	body?: string;
	onSave?: (body: string) => void;
	onCancel?: () => void;
	onDelete?: () => void;
}) {
	const [text, setText] = useState("");
	const input = useRef<HTMLTextAreaElement>(null);
	// Not autoFocus: the card mounts before @pierre/diffs moves it into the document, so that focus is lost.
	useEffect(() => {
		const frame = requestAnimationFrame(() => input.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);
	return (
		<div className="w-full max-w-3xl min-w-0 p-1.5 font-ui">
			<div className="kc-comment overflow-hidden rounded-lg bg-soft">
				<div className="flex items-center justify-between gap-2 px-3 pt-2 pb-0.5">
					<div className="flex min-h-6 items-center gap-2.5">
						<span className="flex size-6 items-center justify-center rounded-full bg-avatar text-[10px] font-medium text-white">
							You
						</span>
						<span className="text-[12px] leading-4 text-tertiary">You</span>
					</div>
					<span className="text-[12px] leading-4 text-tertiary">
						Local comment on line {side === "new" ? "R" : "L"}
						{line}
					</span>
				</div>
				{body !== undefined ? (
					<div className="selectable px-3 py-3 text-[14px] leading-[22.75px] whitespace-pre-wrap text-ink">{body}</div>
				) : (
					<div className="p-3">
						<textarea
							ref={input}
							rows={1}
							value={text}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (matches(e, "desktop.composer.steer") && text.trim()) onSave?.(text.trim());
								// Handled here: the window's Escape would also stop a running turn.
								if (matches(e, "desktop.picker.dismiss")) {
									e.preventDefault();
									onCancel?.();
								}
							}}
							placeholder="Add a comment…"
							className="block w-full resize-none bg-transparent text-[14px] leading-[22.75px] text-ink outline-none placeholder:text-tertiary focus-visible:outline-none"
						/>
					</div>
				)}
				<div className="flex items-center justify-end gap-2 px-3 py-2 text-[13px] text-tertiary">
					{/* Codex's comment buttons: 24px, 10px corners, 12px text. */}
					{body !== undefined ? (
						<Button variant="soft" size="xs" onClick={onDelete} className="rounded-lg px-2 text-xs">
							Delete
						</Button>
					) : (
						<>
							<Button color="secondary" size="xs" onClick={onCancel} className="rounded-lg px-2 text-xs">
								Cancel
							</Button>
							<Button
								variant="solid"
								size="xs"
								disabled={!text.trim()}
								onClick={() => onSave?.(text.trim())}
								className="rounded-lg px-2 text-xs"
							>
								Comment
							</Button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

type Annotation = { comment?: DiffComment };

/**
 * The loader @pierre/diffs calls when a hunk separator is expanded: both sides of the file from the trees of the read
 * that drew it (thread/diff/file), so they always match its hunks. A side the server will not give (binary, over 2
 * MiB, gone) makes the file unexpandable for that read: `onUnavailable` drops the loader, and with it the controls.
 */
export function diffLoader(
	threadId: string,
	trees: { from: string; to: string },
	file: Pick<DiffFile, "path" | "oldPath">,
	onUnavailable: () => void,
): FileDiffContentsLoader {
	return async () => {
		try {
			const sides = await client.request("thread/diff/file", {
				threadId,
				fromTree: trees.from,
				toTree: trees.to,
				path: file.path,
				...(file.oldPath ? { oldPath: file.oldPath } : {}),
			});
			if (sides.binary || sides.tooLarge || sides.old === undefined || sides.new === undefined)
				throw new Error(`${file.path} cannot be expanded`);
			return {
				oldFile: { name: file.oldPath ?? file.path, contents: sides.old },
				newFile: { name: file.path, contents: sides.new },
			};
		} catch (error) {
			onUnavailable();
			throw error;
		}
	};
}

function FileSection({
	threadId,
	root,
	file,
	selector,
	options,
	collapsed,
	onCollapse,
	onAction,
	trees,
	onUnavailable,
}: {
	threadId: string;
	/** The repository's root, which file paths are relative to. */
	root: string;
	file: DiffFile;
	selector: Selector;
	options: { wrap: boolean; split: boolean; wordDiffs: boolean };
	collapsed: boolean;
	onCollapse: () => void;
	onAction: (action: "stage" | "unstage" | "revert", file: DiffFile) => void;
	/** The read's trees while this file can expand; absent, its separators draw no expand control. */
	trees?: { from: string; to: string };
	/** Bound to the read: marks this file unexpandable for it. */
	onUnavailable: () => void;
}) {
	const project = useStore((s) => s.held[threadId]?.thread.projectCwd ?? "");
	const editor = usePreferredTarget(useOpenInTargets(), project);
	const comments = useStore((s) => s.comments[threadId]);
	const [draft, setDraft] = useState<{ side: "old" | "new"; start: number; end: number } | undefined>();
	const mine = useMemo(
		// The exact revision: a comment on commit A, or against main, is not drawn on commit B or another base.
		() =>
			(comments ?? []).filter(
				(c) =>
					c.path === file.path &&
					scopeOf(c) === selector.scope &&
					c.against === selector.against &&
					c.commit === selector.commit,
			),
		[comments, file.path, selector.scope, selector.against, selector.commit],
	);
	const annotations: DiffLineAnnotation<Annotation>[] = [
		...mine.map((comment) => ({
			side: comment.side === "old" ? ("deletions" as const) : ("additions" as const),
			lineNumber: comment.endLine,
			metadata: { comment },
		})),
		...(draft
			? [
					{
						side: draft.side === "old" ? ("deletions" as const) : ("additions" as const),
						lineNumber: draft.end,
						metadata: {},
					},
				]
			: []),
	];
	const full = `${root.replace(/[\\/]+$/, "")}/${file.path}`;
	const scope = selector.scope;
	// The store's theme, which changes only when the theme does: @pierre/diffs restarts its render on any option
	// change, and a restart while the highlighter is still loading leaves the file blank.
	const themeType = useStore((s) => s.resolvedTheme) === "light" ? "light" : "dark";
	// Appearance › Diff markers: Codex's colour bars, or the +/− of a classic diff.
	const indicators = useStore((s) => selectPreferences(s).diffMarkers) === "plusMinus" ? "classic" : "bars";
	const diffOptions = useMemo<FileDiffOptions<Annotation, undefined>>(
		() => ({
			theme: { dark: "pierre-dark", light: "pierre-light" },
			themeType,
			diffStyle: options.split ? ("split" as const) : ("unified" as const),
			diffIndicators: indicators,
			overflow: options.wrap ? ("wrap" as const) : ("scroll" as const),
			hunkSeparators: "line-info" as const,
			lineDiffType: options.wordDiffs ? ("word-alt" as const) : ("none" as const),
			disableFileHeader: true,
			enableGutterUtility: true,
			unsafeCSS: diffOverrides,
			// Made once per read (its trees), so a failure always reports against the read that drew the file.
			...(trees ? { loadDiffFiles: diffLoader(threadId, trees, file, onUnavailable) } : {}),
			onGutterUtilityClick: (range: SelectedLineRange) =>
				setDraft({
					side: range.side === "deletions" ? "old" : "new",
					start: Math.min(range.start, range.end ?? range.start),
					end: Math.max(range.start, range.end ?? range.start),
				}),
		}),
		// The file's identity, not the object: a refresh hands over equal files.
		[themeType, indicators, options.split, options.wrap, options.wordDiffs, threadId, trees?.from, trees?.to, file.path, file.oldPath],
	);
	return (
		<div className="group/file-diff flex flex-col pb-0.5">
			<div className="sticky top-0 z-10 bg-surface">
				{/* A press anywhere on the row opens or closes the file, except on its own buttons and menu (a press in
				    the menu, drawn elsewhere in the document, still bubbles here through React). The name stays a
				    button so the keyboard can reach the toggle. */}
				<div
					onClick={(event) => {
						if (!(event.target as Element).closest("button, .kc-menu")) onCollapse();
					}}
					className="group/diff-header flex items-center gap-2 border-b border-line py-2 ps-3 pe-2 text-[14px] leading-[21px]"
				>
					<div className="flex min-w-0 flex-1 items-center gap-2 ps-1">
						<FileIcon path={file.path} />
						<Tooltip content={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path} align="start">
							<button
								type="button"
								onClick={onCollapse}
								aria-expanded={!collapsed}
								className="min-w-0 truncate text-start"
							>
								<span className="text-tertiary">{dirOf(file.path)}</span>
								<span className="text-ink">{nameOf(file.path)}</span>
							</button>
						</Tooltip>
						{/* As in Codex: shown while the header is hovered, pointing down while the diff is open. It fades
						    in and turns as the file opens and closes (150 ms). */}
						<ChevronRight
							size={16}
							className={`shrink-0 text-tertiary opacity-0 transition-[rotate,opacity] group-hover/diff-header:opacity-100 motion-reduce:transition-none ${collapsed ? "" : "rotate-90"}`}
						/>
					</div>
					<div className="ms-auto flex shrink-0 items-center gap-1">
						<Totals additions={file.additions} deletions={file.deletions} className="ms-1 me-1 text-[14px]" />
						{/* Codex's "Open file in a tab", at the file's first change. */}
						<IconButton
							label="Open file in a tab"
							size="3xs"
							round
							disabled={file.status === "deleted"}
							onClick={() => openFileTab(threadId, full, firstChange(file))}
						>
							<ExternalLink size={16} />
						</IconButton>
						<Menu>
							<MenuTrigger>
								<IconButton label="File actions" size="3xs" round>
									<MoreHorizontal size={16} />
								</IconButton>
							</MenuTrigger>
							<MenuContent align="end">
								<MenuItem onSelect={() => void client.host("host/clipboard/writeText", { text: full })}>
									Copy path
								</MenuItem>
								<MenuItem
									disabled={file.status === "deleted"}
									onSelect={() => openFileTab(threadId, full, firstChange(file))}
								>
									Open file
								</MenuItem>
								<MenuItem
									disabled={!editor || file.status === "deleted"}
									onSelect={() => editor && openIn(editor.id, full, firstChange(file))}
								>
									{editor ? `Open in ${editor.name}` : "Open in editor"}
								</MenuItem>
								<MenuItem onSelect={onCollapse}>{collapsed ? "Expand file" : "Collapse file"}</MenuItem>
								{scope === "committed" ? null : <MenuSeparator />}
								{scope === "uncommitted" || scope === "unstaged" ? (
									<MenuItem onSelect={() => onAction("stage", file)}>Stage file</MenuItem>
								) : null}
								{scope === "staged" ? (
									<MenuItem onSelect={() => onAction("unstage", file)}>Unstage file</MenuItem>
								) : null}
								{scope !== "staged" && scope !== "committed" ? (
									<MenuItem danger onSelect={() => onAction("revert", file)}>
										{scope === "lastTurn" ? "Undo file" : "Revert file"}
									</MenuItem>
								) : null}
							</MenuContent>
						</Menu>
					</div>
				</div>
			</div>
			{collapsed ? null : file.binary || file.tooLarge || file.hunks.length === 0 ? (
				<div className="px-4 py-3 text-[13px] text-tertiary">
					{file.binary
						? "Binary file not shown"
						: file.tooLarge
							? "This diff is too large to show here"
							: file.status === "renamed"
								? `Renamed from ${file.oldPath}`
								: "No content changes"}
				</div>
			) : (
				<PatchDiff<Annotation>
					// One per read: PatchDiff keeps its parsed (and once expanded, hydrated) file by patch text alone, and a
					// later read can carry the same patch between other trees.
					key={trees ? `${trees.from}:${trees.to}` : "fixed"}
					patch={patchOf(file)}
					disableWorkerPool
					options={diffOptions}
					// The selection follows the open draft: left to the library, it outlives a save or cancel, and the next
					// "+" reuses it instead of the line clicked.
					selectedLines={
						draft
							? { start: draft.start, end: draft.end, side: draft.side === "old" ? "deletions" : "additions" }
							: null
					}
					lineAnnotations={annotations}
					renderAnnotation={(annotation) => {
						const comment = annotation.metadata.comment;
						if (comment)
							return (
								<CommentCard
									line={comment.endLine}
									side={comment.side}
									body={comment.body}
									onDelete={() => removeComment(threadId, comment)}
								/>
							);
						if (!draft) return null;
						return (
							<CommentCard
								line={draft.end}
								side={draft.side}
								onCancel={() => setDraft(undefined)}
								onSave={(body) => {
									addComment(threadId, {
										scope,
										...(selector.against ? { against: selector.against } : {}),
										...(selector.commit ? { commit: selector.commit } : {}),
										path: file.path,
										side: draft.side,
										startLine: draft.start,
										endLine: draft.end,
										body,
									});
									setDraft(undefined);
								}}
							/>
						);
					}}
				/>
			)}
		</div>
	);
}

/**
 * A diff first rendered while the shared highlighter is still loading stays blank: @pierre/diffs 1.5.2 caches nothing
 * for it, then drops the highlighted result for want of a cache entry. With the highlighter and its themes loaded first,
 * a file renders as plain text at once and picks up its highlighting when its language loads.
 */
// Settles either way: a highlighter that failed to load leaves diffs as plain text, never blank.
export const highlighterReady = preloadHighlighter({ themes: ["pierre-dark", "pierre-light"], langs: [] }).catch(
	(error: unknown) => console.error("diff highlighter failed to load", error),
);

/** The tree trims a plain space between decoration parts. */
const NBSP = String.fromCodePoint(0xa0);

/** Codex's tree CSS, inside its shadow root: half-size levels with the guides on the icon centers, opaque pinned folders. */
const TREE_CSS = `
	:host {
		--trees-scrollbar-gutter-measured: 0px;
	}
	[data-item-section='spacing']:not(:empty) {
		margin-right: calc((1px - var(--trees-icon-width)) / 4);
	}
	[data-item-section='spacing-item'] + [data-item-section='spacing-item'] {
		margin-left: calc(var(--trees-item-row-gap) + (var(--trees-icon-width) - 1px) / 4);
	}
	[data-item-type='file'] > [data-item-section='spacing']:not(:empty) {
		margin-right: 0;
	}
	[data-file-tree-sticky-overlay-content='true'],
	[data-file-tree-sticky-row='true'] {
		background-color: var(--kc-bg-surface);
	}
	[data-file-tree-virtualized-scroll='true'] {
		scrollbar-gutter: auto;
	}
`;

/**
 * The changed files as a @pierre/trees tree, after Codex's: folders open, one row per folder, "+N -N" per file with a
 * zero side left out. The model is made once per mount, so a new file set or new totals remount it (keyed by the caller).
 * `selected` is the file shown one at a time in a large diff; the tree selects it and scrolls it into view.
 */
function ChangesTree({
	files,
	selected,
	onSelect,
}: {
	files: DiffFile[];
	selected?: string;
	onSelect: (path: string) => void;
}) {
	const byPath = new Map(files.map((f) => [f.path, f]));
	// The model is made once per mount: it calls the latest handler through a ref, never the mount render's.
	const select = useRef(onSelect);
	select.current = onSelect;
	const { model } = useFileTree({
		paths: files.map((f) => f.path),
		initialExpansion: "open",
		flattenEmptyDirectories: false,
		icons: { set: "complete", colored: true },
		itemHeight: 29,
		stickyFolders: true,
		unsafeCSS: TREE_CSS,
		onSelectionChange: (paths) => {
			const path = paths[0];
			if (path && byPath.has(path)) select.current(path);
		},
		renderRowDecoration: ({ item }) => {
			const file = byPath.get(item.path);
			if (!file) return null;
			const parts = [
				...(file.additions
					? [{ text: `+${file.additions.toLocaleString("en-US")}`, color: "var(--kc-git-added)" }]
					: []),
				...(file.deletions
					? [{ text: `-${file.deletions.toLocaleString("en-US")}`, color: "var(--kc-git-deleted)" }]
					: []),
			].map((part, i) => (i ? { ...part, text: NBSP + part.text } : part));
			return parts.length ? { text: parts.map((p) => p.text).join(""), parts } : null;
		},
	});
	useEffect(() => {
		if (!selected) return;
		for (const path of model.getSelectedPaths()) if (path !== selected) model.getItem(path)?.deselect();
		model.getItem(selected)?.select();
		model.scrollToPath(selected, { focus: false, offset: "nearest" });
	}, [model, selected]);
	return <FileTree model={model} className="kc-tree h-full" />;
}

/**
 * Codex's banner over a large diff (isLargeDiff): the pane shows one file at a time, stepped from here or picked in the
 * tree. Its surface is Codex's status card (25px corners, a hairline ring, 20px in), the arrows its 28px ghosts.
 */
function LargeDiffBanner({ onPrevious, onNext }: { onPrevious?: () => void; onNext?: () => void }) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="mx-2 mb-2 flex items-center gap-3 rounded-3xl bg-panel py-4 ps-5 pe-3 text-sm text-ink shadow-[0_0_0_0.5px_var(--kc-hairline),0_0_2px_0_rgb(0_0_0/5%),0_4px_6px_0_rgb(0_0_0/2%)]"
		>
			<Info size={18} className="shrink-0 text-info" />
			<span className="min-w-0 flex-1 leading-5 select-none">This diff is large, showing one file at a time</span>
			<div className="flex shrink-0 items-center gap-2">
				<Tooltip content="Previous file">
					<Button uniform pill aria-label="Previous file" disabled={!onPrevious} onClick={onPrevious}>
						<ChevronLeft size={14} />
					</Button>
				</Tooltip>
				<Tooltip content="Next file">
					<Button uniform pill aria-label="Next file" disabled={!onNext} onClick={onNext}>
						<ChevronRight size={14} />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}

function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
			<FileDiff size={64} strokeWidth={0.85} className="mb-3 -rotate-6 text-ink/85" />
			<div className="text-[16px] leading-6 font-semibold text-ink">{title}</div>
			<div className="text-[13px] leading-5 text-tertiary">{detail}</div>
			{action}
		</div>
	);
}

export function ChangesPane({ threadId }: { threadId: string }) {
	const thread = useStore((s) => s.held[threadId]?.thread);
	const version = useStore((s) => s.diffVersion[threadId] ?? 0);
	// Another surface can ask for a scope (the edited-files card opens Last Turn); take it once. A pane opened that way
	// starts on it, so it never reads Uncommitted first.
	const [selector, setSelector] = useState<Selector>(() => ({ scope: getState().panel.scope ?? "uncommitted" }));
	const asked = useStore((s) => s.panel.scope);
	useEffect(() => {
		if (!asked) return;
		setSelector((s) => (s.scope === asked && !s.against && !s.commit ? s : { scope: asked }));
		setPanel({ scope: undefined });
	}, [asked]);
	// A read shows only under the selector it was made for: a new scope shows nothing until its own diff arrives, not
	// the previous scope's under the new label, and a slower earlier read never lands over a later one.
	const [loaded, setLoaded] = useState<{ selector: Selector; read?: Read; error?: RequestError | Error }>();
	const latest = useRef(0);
	const read = loaded?.selector === selector ? loaded.read : undefined;
	const error = loaded?.selector === selector ? loaded.error : undefined;
	const [loading, setLoading] = useState(false);
	const [highlighter, setHighlighter] = useState(isHighlighterLoaded);
	useEffect(() => {
		if (!highlighter) void highlighterReady.then(() => setHighlighter(true));
	}, [highlighter]);
	const [opts, setOpts] = useState({
		fullFiles: false,
		wordDiffs: true,
		ignoreWhitespace: false,
		wrap: false,
		split: false,
		tree: true,
	});
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [filter, setFilter] = useState("");
	const [treeWidth, setTreeWidth] = useState(250);
	// The file tree stays mounted while it slides shut (styles.css, .kc-tree-slot), and slides open only when opened.
	const [treeShown, setTreeShown] = useState<"open" | "opened" | false>(opts.tree && "open");
	if (opts.tree && !treeShown) setTreeShown("opened");
	const [commits, setCommits] = useState<ResultOf<"git/log">["commits"]>([]);
	const [branches, setBranches] = useState<ResultOf<"git/branches">>();
	const scroller = useRef<HTMLDivElement>(null);
	const pane = useRef<HTMLDivElement>(null);
	const compact = useWidth(pane) < COMPACT_WIDTH;
	const filterRef = useRef<HTMLInputElement>(null);

	const load = useCallback(async () => {
		if (selector.scope === "committed" && !selector.commit) return;
		const id = ++latest.current;
		setLoading(true);
		try {
			const read = await client.request("thread/diff/read", {
				threadId,
				scope: selector.scope,
				...(selector.against ? { against: selector.against } : {}),
				...(selector.commit ? { commit: selector.commit } : {}),
				context: opts.fullFiles ? 1_000_000 : 3,
				...(opts.ignoreWhitespace ? { ignoreWhitespace: true } : {}),
			});
			if (id === latest.current) setLoaded({ selector, read });
		} catch (e) {
			if (id === latest.current) setLoaded({ selector, error: e instanceof Error ? e : new Error(String(e)) });
		} finally {
			if (id === latest.current) setLoading(false);
		}
	}, [threadId, selector, opts.fullFiles, opts.ignoreWhitespace]);
	useEffect(() => {
		void load();
	}, [load, version]);
	// The Branch scope compares against the default branch until another is picked; name it, not its SHA.
	useEffect(() => {
		if (selector.scope !== "branch") return;
		void client
			.request("git/branches", { threadId })
			.then(setBranches)
			.catch(() => {});
	}, [threadId, selector.scope]);
	useEffect(() => {
		const onFocus = () => void load();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [load]);

	const files = read?.files ?? [];
	const shown = filter ? files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())) : files;
	// Files whose sides the server would not give for these trees; a read of other trees starts with none. Keyed by the
	// trees, not the read: a reload of an unchanged checkout is a new read whose files' loaders are still the old ones.
	const treesKey = read?.fromTree && read.toTree ? `${read.fromTree}:${read.toTree}` : undefined;
	const [unexpandable, setUnexpandable] = useState<{ trees?: string; paths: ReadonlySet<string> }>({
		paths: new Set(),
	});
	const blocked = treesKey && unexpandable.trees === treesKey ? unexpandable.paths : NONE;
	const markUnexpandable = (trees: string, path: string) =>
		setUnexpandable((u) => ({ trees, paths: new Set([...(u.trees === trees ? u.paths : []), path]) }));
	// Expansion needs the read's trees, and whitespace-blind hunks do not line up with the files' own text.
	const treesOf = (file: DiffFile) =>
		read?.fromTree && read.toTree && !opts.ignoreWhitespace && !blocked.has(file.path)
			? { from: read.fromTree, to: read.toTree }
			: undefined;
	// A large diff shows one file at a time (Codex's): the one picked, while the filter keeps it, else the first. The
	// arrows step through the files in the tree's order (folders first), not the server's.
	const large = useMemo(() => isLargeDiff(read?.files ?? []), [read]);
	const steps = useMemo(() => {
		if (!large) return [];
		const byPath = new Map(shown.map((f) => [f.path, f]));
		return prepareFileTreeInput([...byPath.keys()]).paths.flatMap((path) => byPath.get(path) ?? []);
	}, [large, read, filter]);
	const [picked, setPicked] = useState<string>();
	const current = steps.find((f) => f.path === picked) ?? steps[0];
	const at = current ? steps.indexOf(current) : -1;
	const pick = (path: string) => {
		if (path === current?.path) return;
		setPicked(path);
		scroller.current?.scrollTo({ top: 0 });
	};
	const allCollapsed = files.length > 0 && collapsed.size === files.length;
	const label = SCOPES.find((s) => s.scope === selector.scope)!.label;
	const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(files.map((f) => f.path)));

	const act = async (action: "stage" | "unstage" | "revert", file: DiffFile) => {
		try {
			if (action === "revert") {
				if (!window.confirm(`${selector.scope === "lastTurn" ? "Undo" : "Revert"} the changes to ${file.path}?`))
					return;
				await client.request("thread/diff/revert", {
					threadId,
					scope: selector.scope,
					...(selector.against ? { against: selector.against } : {}),
					// The turn shown: one that ended since is not reverted in its place.
					...(selector.scope === "lastTurn" && read?.turnId ? { turnId: read.turnId } : {}),
					path: file.path,
				});
			} else await client.request(action === "stage" ? "git/stage" : "git/unstage", { threadId, path: file.path });
			await load();
		} catch (e) {
			toast(errorText(e), "error");
		}
	};

	const copyApply = () => {
		// The patch is rebuilt from hunks with plain headers: anything it cannot carry (binary, too large, omitted or
		// skipped files, renames, type changes, a file with no hunks, whitespace-blind hunks) refuses a partial one.
		if (
			read?.filesOmitted ||
			read?.untrackedSkipped ||
			opts.ignoreWhitespace ||
			files.some(
				(f) => f.binary || f.tooLarge || f.status === "renamed" || f.status === "typeChanged" || f.hunks.length === 0,
			)
		)
			return toast("These changes include files a git apply command cannot carry", "error");
		const patch = files.map(patchOf).join("");
		// A bash heredoc, or on Windows a PowerShell here-string written to a temp file: PowerShell's pipe to a native
		// command turns the patch's LF lines into CRLF, which git apply rejects (probed in pwsh 7 and PowerShell 5.1).
		// A patch line that would end either early (a "KNIGHTCODE_PATCH" line, a line starting '@) gets no command, nor
		// one with CRLF lines: a pasted command cannot keep their CRs apart from its own line ends.
		const windows = window.knightcode.platform === "win32";
		if (
			patch.includes("\r") ||
			patch.split("\n").some((line) => (windows ? line.startsWith("'@") : line === "KNIGHTCODE_PATCH"))
		)
			return toast("These changes contain lines a pasted git apply command cannot carry", "error");
		void client.host("host/clipboard/writeText", {
			text: windows
				? `$p = Join-Path ([IO.Path]::GetTempPath()) 'knightcode.patch'; [IO.File]::WriteAllText($p, (@'\n${patch}'@ -replace "\`r") + "\`n"); git apply $p\n`
				: `git apply <<'KNIGHTCODE_PATCH'\n${patch}KNIGHTCODE_PATCH\n`,
		});
	};

	const scrollTo = (path: string) => {
		const index = shown.findIndex((f) => f.path === path);
		scroller.current?.querySelectorAll<HTMLElement>("[data-file-section]")[index]?.scrollIntoView({ block: "start" });
	};

	const notGit = error instanceof RequestError && error.code === "notGitRepo";
	return (
		<div
			ref={pane}
			className="kc-changes flex h-full min-h-0 min-w-0 flex-col"
			aria-label="Changes"
			aria-busy={loading}
		>
			<header className="relative z-20 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 p-2 text-[13px]">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<Capsule label="Review source">
						<Menu>
							<MenuTrigger>
								<button
									type="button"
									className="flex h-7 min-w-0 items-center gap-1 rounded-full ps-3 pe-1.5 text-[13px] leading-5 text-ink hover:bg-ghost-hover data-[state=open]:bg-ghost-hover"
								>
									<span className="min-w-0 truncate">{label}</span>
									<ChevronDown size={14} className="shrink-0" />
								</button>
							</MenuTrigger>
							<MenuContent minWidth={200}>
								<MenuRadioGroup
									value={selector.scope}
									onValueChange={(scope) => setSelector({ scope: scope as DiffScope })}
								>
									{SCOPES.map(({ scope, label: name }, i) => (
										<Fragment key={scope}>
											{i === 1 || i === 4 ? <MenuSeparator /> : null}
											{scope === "committed" ? (
												// "Committed ›": the commits since the base, from git/log; picking one shows exactly that commit.
												<MenuSub
													label={name}
													className="max-h-80 w-72 overflow-y-auto"
													onOpenChange={(open) => {
														if (open)
															void client
																.request("git/log", { threadId })
																.then((r) => setCommits(r.commits))
																.catch((e: unknown) => toast(errorText(e), "error"));
													}}
												>
													{commits.length === 0 ? (
														<div className="px-2 py-1.5 text-[13px] text-tertiary">No commits since the base</div>
													) : (
														commits.map((c) => (
															<MenuItem
																key={c.sha}
																description={`${c.sha.slice(0, 7)} · ${c.author}`}
																onSelect={() => setSelector({ scope: "committed", commit: c.sha })}
															>
																{c.subject}
															</MenuItem>
														))
													)}
												</MenuSub>
											) : (
												<MenuRadioItem value={scope}>{name}</MenuRadioItem>
											)}
										</Fragment>
									))}
								</MenuRadioGroup>
							</MenuContent>
						</Menu>
						{read && files.length > 0 ? (
							<Totals
								additions={sum(files, "additions")}
								deletions={sum(files, "deletions")}
								className="me-1 text-[14px]"
							/>
						) : null}
					</Capsule>
					{selector.scope === "branch" ? (
						<Capsule label="Branch base">
							<Menu>
								<MenuTrigger>
									<button
										type="button"
										className="flex h-7 items-center gap-1 rounded-full ps-3 pe-1.5 text-[13px] text-ink hover:bg-ghost-hover data-[state=open]:bg-ghost-hover"
									>
										<span className="text-tertiary">HEAD →</span>
										<span>
											{selector.against ?? branches?.defaultBranch ?? read?.against?.slice(0, 12) ?? "Select branch"}
										</span>
										<ChevronDown size={14} />
									</button>
								</MenuTrigger>
								<MenuContent className="max-h-80 overflow-y-auto">
									<MenuRadioGroup
										value={selector.against ?? branches?.defaultBranch ?? ""}
										onValueChange={(against) => setSelector({ scope: "branch", against })}
									>
										{(branches?.branches ?? []).map((b) => (
											<MenuRadioItem key={b} value={b}>
												{b}
											</MenuRadioItem>
										))}
									</MenuRadioGroup>
								</MenuContent>
							</Menu>
						</Capsule>
					) : null}
				</div>
				<div className="ms-auto flex shrink-0 items-center gap-1.5">
					<Capsule label="Changes controls">
						{/* Codex's "Changes options": an icon on every row, a check at the end of each setting that is on. A
						    narrow pane folds Refresh, Word wrap, the layout switch and Collapse all in here (Codex's). */}
						<Menu>
							<MenuTrigger>
								<ControlButton label="Changes options">
									<MoreHorizontal size={16} />
								</ControlButton>
							</MenuTrigger>
							<MenuContent align="end">
								{compact ? (
									<>
										<MenuItem icon={<RefreshCw />} onSelect={() => void load()}>
											Refresh
										</MenuItem>
										<MenuCheckboxItem
											icon={<WrapText />}
											checked={opts.wrap}
											onCheckedChange={(wrap) => setOpts((o) => ({ ...o, wrap }))}
										>
											Word wrap
										</MenuCheckboxItem>
										<MenuItem
											icon={opts.split ? <Columns2 /> : <Rows2 />}
											onSelect={() => setOpts((o) => ({ ...o, split: !o.split }))}
										>
											{opts.split ? "Switch to unified diff" : "Switch to split diff"}
										</MenuItem>
										<MenuItem icon={allCollapsed ? <ExpandAll /> : <CollapseAll />} onSelect={toggleAll}>
											{allCollapsed ? "Expand all diffs" : "Collapse all diffs"}
										</MenuItem>
										<MenuSeparator />
									</>
								) : null}
								<MenuCheckboxItem
									icon={<File />}
									checked={opts.fullFiles}
									onCheckedChange={(fullFiles) => setOpts((o) => ({ ...o, fullFiles }))}
								>
									Load full files
								</MenuCheckboxItem>
								<MenuCheckboxItem
									icon={<FileDiff />}
									checked={opts.wordDiffs}
									onCheckedChange={(wordDiffs) => setOpts((o) => ({ ...o, wordDiffs }))}
								>
									Word diffs
								</MenuCheckboxItem>
								<MenuCheckboxItem
									icon={<Eye />}
									checked={opts.ignoreWhitespace}
									onCheckedChange={(ignoreWhitespace) => setOpts((o) => ({ ...o, ignoreWhitespace }))}
								>
									Hide white space
								</MenuCheckboxItem>
								<MenuItem icon={<Clipboard />} disabled={files.length === 0} onSelect={copyApply}>
									Copy git apply command
								</MenuItem>
							</MenuContent>
						</Menu>
						<ControlButton
							label="Jump to file"
							onClick={() => {
								setOpts((o) => ({ ...o, tree: true }));
								requestAnimationFrame(() => filterRef.current?.focus());
							}}
						>
							<FileSearch size={16} />
						</ControlButton>
						{compact ? null : (
							<>
								<ControlButton label="Refresh" onClick={() => void load()}>
									<RefreshCw size={16} className={loading ? "animate-spin" : ""} />
								</ControlButton>
								<ControlButton
									label="Word wrap"
									pressed={opts.wrap}
									onClick={() => setOpts((o) => ({ ...o, wrap: !o.wrap }))}
								>
									<WrapText size={16} />
								</ControlButton>
								<ControlButton label={allCollapsed ? "Expand all diffs" : "Collapse all diffs"} onClick={toggleAll}>
									{allCollapsed ? <ExpandAll size={16} /> : <CollapseAll size={16} />}
								</ControlButton>
								{/* As in Codex, the icon shows the layout in use and the label the one a click switches to. */}
								<ControlButton
									label={opts.split ? "Switch to unified diff" : "Switch to split diff"}
									onClick={() => setOpts((o) => ({ ...o, split: !o.split }))}
								>
									{opts.split ? <Columns2 size={16} /> : <Rows2 size={16} />}
								</ControlButton>
							</>
						)}
						<ControlButton
							label={opts.tree ? "Hide files" : "Show files"}
							pressed={opts.tree}
							onClick={() => setOpts((o) => ({ ...o, tree: !o.tree }))}
						>
							<Folders size={16} />
						</ControlButton>
					</Capsule>
				</div>
			</header>
			{read?.untrackedSkipped ? (
				<div className="mx-2 mb-2 flex items-center gap-3 rounded-xl bg-ghost-hover px-3 py-2 text-[13px] text-tertiary">
					<span className="flex-1">
						Showing tracked changes only ({read.untrackedSkipped} untracked files skipped). Add build output to
						.gitignore to see the rest.
					</span>
					<button type="button" onClick={() => void load()} className="text-ink hover:underline">
						Refresh
					</button>
				</div>
			) : null}
			{large && !error ? (
				<LargeDiffBanner
					onPrevious={at > 0 ? () => pick(steps[at - 1]!.path) : undefined}
					onNext={at >= 0 && at < steps.length - 1 ? () => pick(steps[at + 1]!.path) : undefined}
				/>
			) : null}
			<div className="flex min-h-0 flex-1 border-t border-line">
				<div ref={scroller} className="min-w-0 flex-1 overflow-y-auto pb-3">
					{notGit ? (
						<Empty title="Not a git repository" detail="Changes appear for folders under git." />
					) : error ? (
						<Empty
							title="Couldn't load changes"
							detail="Refresh to try loading the changes again"
							action={
								<button
									type="button"
									onClick={() => void load()}
									className="mt-3 h-7 rounded-lg bg-ghost-hover px-2.5 text-[13px] text-ink hover:bg-ghost-hover"
								>
									Retry
								</button>
							}
						/>
					) : read && files.length === 0 ? (
						<Empty
							title="No file changes yet"
							detail={
								selector.scope === "lastTurn"
									? read.stale
										? "The latest diffs are no longer available."
										: "Files that changed while the last turn ran appear here."
									: "Changes in this project will appear here."
							}
						/>
					) : (
						<>
							{selector.scope === "lastTurn" && files.length > 0 ? (
								<div className="px-4 pt-2 pb-1 text-[12px] text-tertiary">Files that changed while this turn ran</div>
							) : null}
							{(highlighter ? (large ? (current ? [current] : []) : shown) : []).map((file) => (
								<div
									key={`${selector.scope}:${selector.against ?? ""}:${selector.commit ?? ""}:${file.path}`}
									data-file-section=""
								>
									<FileSection
										threadId={threadId}
										root={read?.root ?? ""}
										file={file}
										selector={selector}
										options={opts}
										collapsed={collapsed.has(file.path)}
										onCollapse={() =>
											setCollapsed((set) => {
												const next = new Set(set);
												if (next.has(file.path)) next.delete(file.path);
												else next.add(file.path);
												return next;
											})
										}
										onAction={(action, f) => void act(action, f)}
										trees={treesOf(file)}
										onUnavailable={() => treesKey && markUnexpandable(treesKey, file.path)}
									/>
								</div>
							))}
							{read?.filesOmitted ? (
								<div className="px-4 py-3 text-[13px] text-tertiary">{read.filesOmitted} more files are not shown.</div>
							) : null}
						</>
					)}
				</div>
				{treeShown && !notGit ? (
					<div
						className="kc-tree-slot flex shrink-0"
						data-open={opts.tree || undefined}
						data-enter={treeShown === "opened" || undefined}
						inert={!opts.tree}
						onTransitionEnd={(e) => {
							if (e.target === e.currentTarget && !opts.tree) setTreeShown(false);
						}}
					>
						<div
							style={{ width: treeWidth }}
							className="relative flex h-full max-w-full shrink-0 flex-col border-l border-line px-1"
						>
							<TreeResizeHandle
								width={treeWidth}
								onWidth={setTreeWidth}
								onOpen={(tree) => setOpts((o) => ({ ...o, tree }))}
							/>
							<div className="flex shrink-0 items-center gap-1 px-1 pt-1 pb-px">
								<label className="flex h-7 w-full items-center gap-1.5 rounded-lg border border-line bg-soft ps-2 text-[14px] leading-[18px]">
									<Search size={14} className="shrink-0 text-tertiary" />
									<input
										ref={filterRef}
										value={filter}
										onChange={(e) => setFilter(e.target.value)}
										// Escape clears the filter, and never reaches the window's stop-the-turn binding.
										onKeyDown={(e) => {
											if (!matches(e, "desktop.picker.dismiss")) return;
											e.preventDefault();
											setFilter("");
										}}
										placeholder="Filter files…"
										className="w-full bg-transparent pe-1.5 text-ink outline-none placeholder:text-tertiary focus-visible:outline-none"
									/>
								</label>
							</div>
							<div className="min-h-0 flex-1 overflow-y-auto px-1 pt-1">
								{shown.length === 0 && filter ? (
									<div className="px-2 py-1.5 text-[13px] text-ink">No matching files</div>
								) : (
									<ChangesTree
										key={shown.map((f) => `${f.path}:${f.additions}:${f.deletions}`).join("|")}
										files={shown}
										selected={current?.path}
										onSelect={large ? pick : scrollTo}
									/>
								)}
							</div>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
