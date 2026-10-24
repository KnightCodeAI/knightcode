/**
 * A file tab (desktop-shell.md section 9.6), Codex's file viewer (26.1016 `text-file-editor-tab-content`, measured over
 * CDP): a toolbar of capsules (the path as a breadcrumb; the comparison, Codex's "Unstaged ▾" beside Hide changes, or
 * Show changes while they are hidden; the change navigation; the diff layout and Toggle file tree; the Open split
 * button) over the file in @pierre/diffs (12px code on 22px lines, the Changes pane's theme), its changes in the
 * comparison drawn in place, the whole file expanded, and the workspace tree on the right. The server reads the file
 * (file/read) and the comparison's side of it (thread/diff/read, thread/diff/file), as it reads every file the desktop
 * shows.
 */

import type { ResultOf } from "@knightcode/app-server-protocol";
import {
	type ChangeContent,
	type FileDiffMetadata,
	type FileDiffOptions,
	type FileOptions,
	isHighlighterLoaded,
	parseDiffFromFile,
} from "@pierre/diffs";
import { FileDiff, File } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import diffOverrides from "../diff-overrides.css?raw";
import { basename, samePath } from "../format.ts";
import { matches } from "../keys.ts";
import {
	errorText,
	type FileComparison,
	openFileTab,
	selectPreferences,
	setFileComparison,
	setPanel,
	useStore,
} from "../store.ts";
import { IconButton } from "./button.tsx";
import { highlighterReady } from "./changes.tsx";
import { FilesTree, joinPath, TreeToggle } from "./files-panel.tsx";
import { FindBar } from "./find-bar.tsx";
import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Columns2,
	FileDiff as FileDiffIcon,
	File as FileIcon,
	MoreHorizontal,
	Rows2,
	X,
} from "./icons.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuTrigger } from "./menu.tsx";
import { OpenInButton } from "./open-in.tsx";
import { Popover } from "./popover.tsx";

type Read = ResultOf<"file/read">;

const slashes = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

/** The breadcrumb: the thread's folder and the path under it, or the whole path for a file outside it. */
export function crumbs(path: string, cwd: string): string[] {
	const file = slashes(path);
	const root = slashes(cwd);
	const win = /^[a-zA-Z]:/.test(file);
	const within = root && (win ? file.toLowerCase() : file).startsWith(`${win ? root.toLowerCase() : root}/`);
	if (within) return [basename(root), ...file.slice(root.length + 1).split("/")];
	return file.split("/").filter(Boolean);
}

/** `title`: the whole path, shown on hover as Codex does, since a narrow toolbar clips the crumbs. */
export function Breadcrumb({ segments, title }: { segments: string[]; title?: string }) {
	return (
		<div className="kc-capsule flex h-8 min-w-0 shrink items-center rounded-full p-0.5">
			<nav aria-label="File path" title={title} className="flex h-full min-w-0 items-center overflow-hidden px-2">
				<ol className="flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-[18.5px] text-secondary select-text">
					{segments.map((segment, i) => {
						const last = i === segments.length - 1;
						return (
							<li key={i} className={`flex items-center gap-1 ${last ? "min-w-0" : "shrink-0"}`}>
								<span className={last ? "min-w-0 truncate font-medium text-ink" : "whitespace-nowrap"}>{segment}</span>
								{last ? null : <ChevronRight size={14} className="shrink-0 text-tertiary" />}
							</li>
						);
					})}
				</ol>
			</nav>
		</div>
	);
}

function Notice({ title, detail }: { title: string; detail?: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
			<FileIcon size={48} strokeWidth={0.85} className="mb-2 text-ink/85" />
			<div className="text-[15px] leading-6 font-semibold text-ink">{title}</div>
			{detail ? <div className="text-[13px] leading-5 text-tertiary">{detail}</div> : null}
		</div>
	);
}

/** Codex's order: the comparison's changed files first, so the default is the first that holds the file. */
const COMPARISONS: FileComparison["scope"][] = ["unstaged", "uncommitted", "branch"];

/**
 * The comparison's side of a file: its text at the comparison's base, "" for a file the comparison adds, and null
 * when the comparison does not change it (Codex's baseline: the file itself).
 */
export async function comparisonBase(threadId: string, path: string, compare: FileComparison): Promise<string | null> {
	const read = await client.request("thread/diff/read", {
		threadId,
		scope: compare.scope,
		...(compare.against ? { against: compare.against } : {}),
	});
	const file = read.files.find((f) => samePath(joinPath(read.root, f.path), path));
	if (!file) return null;
	if (file.status === "added") return "";
	if (!read.fromTree || !read.toTree) throw new Error("This comparison has no trees to read the file from");
	const sides = await client.request("thread/diff/file", {
		threadId,
		fromTree: read.fromTree,
		toTree: read.toTree,
		path: file.path,
		...(file.oldPath ? { oldPath: file.oldPath } : {}),
	});
	return sides.binary || sides.tooLarge ? null : (sides.old ?? "");
}

/**
 * The comparison Show changes picks (Codex's default): the first that changes the file, none when none does.
 * ponytail: up to three whole diff reads per file; a server call that answers for one path if this shows up slow.
 */
async function defaultComparison(threadId: string, path: string): Promise<FileComparison | undefined> {
	for (const scope of COMPARISONS) {
		const read = await client.request("thread/diff/read", { threadId, scope }).catch(() => undefined);
		if (read?.files.some((f) => samePath(joinPath(read.root, f.path), path))) return { scope };
	}
	return undefined;
}

/** The changed sections of a diff, in order (Codex counts these): runs of added and deleted lines. */
export function changeBlocks(diff: FileDiffMetadata): ChangeContent[] {
	return diff.hunks.flatMap((hunk) => hunk.hunkContent).filter((c): c is ChangeContent => c.type === "change");
}

/** The row a change starts at: its first added line, or for a deletion alone its first deleted line. */
function blockSelector(block: ChangeContent): string {
	return block.additions > 0
		? `[data-line="${block.additionLineIndex + 1}"]:not([data-line-type="change-deletion"])`
		: `[data-line="${block.deletionLineIndex + 1}"][data-line-type="change-deletion"]`;
}

/** Scrolls `scroller` (vertically only, so the code never slides under its line numbers) to center the row. */
function centerRow(scroller: HTMLElement | null, selector: string): boolean {
	const host = scroller?.querySelector("diffs-container") ?? scroller?.firstElementChild;
	const row = host?.shadowRoot?.querySelector(selector) ?? host?.querySelector(selector);
	if (!row || !scroller) return false;
	const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	scroller.scrollTop += top - (scroller.clientHeight - row.getBoundingClientRect().height) / 2;
	return true;
}

/** Codex's comparison capsule: the picker (Index, HEAD, a branch) joined to Hide changes. */
function ComparisonControls({
	threadId,
	compare,
	onSelect,
	onHide,
}: {
	threadId: string;
	compare: FileComparison;
	onSelect: (compare: FileComparison) => void;
	onHide: () => void;
}) {
	const [branches, setBranches] = useState<string[]>();
	const label = compare.scope === "unstaged" ? "Unstaged" : compare.scope === "uncommitted" ? "Uncommitted" : (compare.against ?? "Branch");
	return (
		<div role="group" aria-label="File comparison" className="kc-capsule inline-flex h-8 min-w-0 shrink-0 items-center rounded-full p-0.5">
			<Menu>
				<MenuTrigger>
					<button
						type="button"
						className="flex h-7 min-w-0 items-center gap-1.5 rounded-full ps-2.5 pe-1.5 text-[13px] leading-5 text-ink hover:bg-ghost-hover data-[state=open]:bg-ghost-hover"
					>
						<FileDiffIcon size={16} className="shrink-0" />
						<span className="min-w-0 truncate">{label}</span>
						<ChevronDown size={14} className="shrink-0" />
					</button>
				</MenuTrigger>
				<MenuContent minWidth={220}>
					<MenuRadioGroup
						value={compare.scope === "branch" ? "" : compare.scope}
						onValueChange={(scope) => onSelect({ scope: scope as FileComparison["scope"] })}
					>
						<MenuRadioItem value="unstaged" description="Unstaged changes">
							Index
						</MenuRadioItem>
						<MenuRadioItem value="uncommitted" description="Uncommitted changes">
							HEAD
						</MenuRadioItem>
					</MenuRadioGroup>
					<MenuSeparator />
					<MenuSub
						label="Branch"
						className="max-h-80 overflow-y-auto"
						minWidth={200}
						onOpenChange={(open) => {
							if (open)
								void client.request("git/branches", { threadId }).then(
									(r) => setBranches(r.branches),
									() => setBranches([]),
								);
						}}
					>
						{branches === undefined ? (
							<div className="px-2 py-1.5 text-[13px] text-tertiary">Loading…</div>
						) : branches.length === 0 ? (
							<div className="px-2 py-1.5 text-[13px] text-tertiary">No branches</div>
						) : (
							<MenuRadioGroup
								value={compare.scope === "branch" ? (compare.against ?? "") : ""}
								onValueChange={(against) => onSelect({ scope: "branch", against })}
							>
								{branches.map((b) => (
									<MenuRadioItem key={b} value={b}>
										{b}
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
						)}
					</MenuSub>
				</MenuContent>
			</Menu>
			<span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />
			<IconButton label="Hide changes" round onClick={onHide}>
				<X size={16} />
			</IconButton>
		</div>
	);
}

/** Codex's change navigation: previous, the position ("2/3", or the count outside a change), next. */
function ChangeNavigation({ count, active, onGo }: { count: number; active: number; onGo: (index: number) => void }) {
	const previous = active > 0 ? active - 1 : -1;
	const next = active + 1 < count ? active + 1 : -1;
	return (
		<div role="group" aria-label="Navigate changes" className="kc-capsule inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full p-0.5">
			<IconButton label="Previous change" round disabled={previous < 0} onClick={() => onGo(previous)}>
				<ChevronUp size={16} />
			</IconButton>
			<span role="status" aria-atomic className="min-w-6 text-center text-xs text-secondary tabular-nums select-none">
				<span aria-hidden>{active < 0 ? count : `${active + 1}/${count}`}</span>
				<span className="sr-only">
					{active < 0 ? `${count} ${count === 1 ? "change" : "changes"}` : `${active + 1} of ${count}`}
				</span>
			</span>
			<IconButton label="Next change" round disabled={next < 0} onClick={() => onGo(next)}>
				<ChevronDown size={16} />
			</IconButton>
		</div>
	);
}

export function FileTab({
	threadId,
	path,
	line,
	used,
	compare,
}: {
	threadId: string;
	path: string;
	line?: number;
	used: number;
	compare?: FileComparison;
}) {
	const thread = useStore((s) => s.held[threadId]?.thread);
	const version = useStore((s) => s.diffVersion[threadId] ?? 0);
	const themeType = useStore((s) => s.resolvedTheme) === "light" ? "light" : "dark";
	// Appearance › Diff markers, as the Changes pane draws them.
	const indicators = useStore((s) => selectPreferences(s).diffMarkers) === "plusMinus" ? "classic" : "bars";
	const treeShown = useStore((s) => s.panel.fileTree !== false);
	const [loaded, setLoaded] = useState<{ path: string; read?: Read; error?: string }>();
	const [base, setBase] = useState<{ key: string; text?: string | null; error?: string }>();
	const [fallback, setFallback] = useState<{ path: string; compare?: FileComparison }>();
	const [highlighter, setHighlighter] = useState(isHighlighterLoaded);
	const split = useStore((s) => s.panel.fileSplit === true);
	const [active, setActive] = useState(-1);
	const [retry, setRetry] = useState(0);
	const [finding, setFinding] = useState(false);
	const body = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!highlighter) void highlighterReady.then(() => setHighlighter(true));
	}, [highlighter]);
	useEffect(() => {
		let live = true;
		const load = () =>
			client.request("file/read", { threadId, path }).then(
				(read) => live && setLoaded({ path, read }),
				(error: unknown) => live && setLoaded({ path, error: errorText(error) }),
			);
		void load();
		// A turn's edits and a return to the window both show the file as it is now.
		const onFocus = () => void load();
		window.addEventListener("focus", onFocus);
		return () => {
			live = false;
			window.removeEventListener("focus", onFocus);
		};
	}, [threadId, path, version]);

	const read = loaded?.path === path ? loaded.read : undefined;
	const error = loaded?.path === path ? loaded.error : undefined;
	const full = read?.path ?? path;

	// The comparison's side, again after a turn and with each read of the file.
	const baseKey = compare ? `${path}\0${compare.scope}\0${compare.against ?? ""}` : "";
	useEffect(() => {
		if (!compare) return;
		let live = true;
		comparisonBase(threadId, full, compare).then(
			(text) => live && setBase({ key: baseKey, text }),
			(e: unknown) => live && setBase({ key: baseKey, error: errorText(e) }),
		);
		return () => {
			live = false;
		};
	}, [threadId, full, baseKey, version, read?.text, retry]);
	const shownBase = compare && base?.key === baseKey ? base : undefined;

	// While the changes are hidden, the comparison Show changes would pick.
	useEffect(() => {
		if (compare) return;
		let live = true;
		void defaultComparison(threadId, full).then((found) => live && setFallback({ path: full, compare: found }));
		return () => {
			live = false;
		};
	}, [threadId, full, compare, version]);
	const showable = fallback?.path === full ? fallback.compare : undefined;

	// The same object while the text is the same, so a reload of an unchanged file redraws nothing.
	const file = useMemo(
		() => (read?.text !== undefined ? { name: basename(read.path), contents: read.text } : undefined),
		[read?.path, read?.text],
	);
	const diff = useMemo(() => {
		const text = shownBase?.text;
		if (typeof text !== "string") return undefined;
		const name = basename(path);
		// A file the comparison deletes cannot be read: its old text against nothing, as Codex shows it.
		if (!file) return error && text ? parseDiffFromFile({ name, contents: text }, { name, contents: "" }) : undefined;
		return text === file.contents ? undefined : parseDiffFromFile({ name: file.name, contents: text }, file);
	}, [file, shownBase?.text, error, path]);
	const blocks = useMemo(() => (diff ? changeBlocks(diff) : []), [diff]);

	const fileOptions = useMemo<FileOptions<undefined, undefined>>(
		() => ({
			theme: { dark: "pierre-dark", light: "pierre-light" },
			themeType,
			overflow: "scroll",
			disableFileHeader: true,
			unsafeCSS: diffOverrides,
		}),
		[themeType],
	);
	const diffOptions = useMemo<FileDiffOptions<undefined, undefined>>(
		() => ({
			theme: { dark: "pierre-dark", light: "pierre-light" },
			themeType,
			diffStyle: split ? "split" : "unified",
			diffIndicators: indicators,
			overflow: "scroll",
			expandUnchanged: true,
			lineDiffType: "word-alt",
			disableFileHeader: true,
			unsafeCSS: diffOverrides,
		}),
		[themeType, split, indicators],
	);

	// The line it was opened at, each time it is opened there (`used` changes), else the first change of a comparison
	// it was opened with (Codex's revealFirstChange): scrolled to the middle once, so a reload after an edit leaves the
	// user's own scrolling alone.
	const scrolled = useRef("");
	const drawn = diff ?? file;
	useEffect(() => {
		const key = `${path}:${line}:${used}`;
		if (!drawn || !highlighter || scrolled.current === key) return;
		if (!line && !(compare && blocks.length > 0)) return;
		const frame = requestAnimationFrame(() => {
			const done = line
				? centerRow(body.current, `[data-line="${line}"]:not([data-line-type="change-deletion"])`)
				: centerRow(body.current, blockSelector(blocks[0]!));
			if (!done) return;
			if (!line) setActive(0);
			scrolled.current = key;
		});
		return () => cancelAnimationFrame(frame);
	}, [path, line, used, drawn, highlighter, compare, blocks]);
	// A different set of changes starts outside them.
	useEffect(() => setActive(-1), [blocks]);

	const go = (index: number) => {
		const block = blocks[index];
		if (block && centerRow(body.current, blockSelector(block))) setActive(index);
	};

	const cwd = thread?.cwd ?? "";
	const selected = line ? { start: line, end: line, side: "additions" as const } : null;
	const controls = (
		<>
			{/* As in Codex, the icon shows the layout in use and the label the one a click switches to. */}
			{compare ? (
				<IconButton label={split ? "Switch to unified diff" : "Switch to split diff"} round onClick={() => setPanel({ fileSplit: !split })}>
					{split ? <Columns2 size={16} /> : <Rows2 size={16} />}
				</IconButton>
			) : null}
			<TreeToggle />
		</>
	);
	return (
		<div
			className="flex h-full min-h-0 min-w-0 flex-col"
			aria-label={basename(path)}
			// Mod+F in the tab finds in the file (Codex's Find in file), not in the thread; again, back to its field.
			onKeyDown={(e) => {
				if (!matches(e.nativeEvent, "desktop.thread.find")) return;
				e.preventDefault();
				const field = e.currentTarget.querySelector<HTMLInputElement>('[role="search"] input');
				if (field) field.select();
				else setFinding(true);
			}}
		>
			<header className="@container/file-header relative z-20 flex shrink-0 items-center gap-1.5 p-2">
				<Breadcrumb segments={crumbs(full, cwd)} title={full} />
				<div className="flex-1" />
				{compare ? (
					<ComparisonControls
						threadId={threadId}
						compare={compare}
						onSelect={(next) => setFileComparison(threadId, path, next)}
						onHide={() => setFileComparison(threadId, path, undefined)}
					/>
				) : showable ? (
					<div className="kc-capsule inline-flex h-8 shrink-0 items-center rounded-full p-0.5">
						<button
							type="button"
							onClick={() => setFileComparison(threadId, path, showable)}
							className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-5 text-ink hover:bg-ghost-hover"
						>
							<FileDiffIcon size={16} className="shrink-0" />
							Show changes
						</button>
					</div>
				) : null}
				{compare && diff ? <ChangeNavigation count={blocks.length} active={active} onGo={go} /> : null}
				{/* Under 625px of toolbar Codex folds the file controls into one button that opens them. */}
				<div role="group" aria-label="File controls" className="kc-capsule hidden h-8 shrink-0 items-center gap-0.5 rounded-full p-0.5 @min-[625px]/file-header:inline-flex">
					{controls}
				</div>
				<div className="kc-capsule inline-flex h-8 shrink-0 items-center rounded-full p-0.5 @min-[625px]/file-header:hidden">
					<Popover
						side="bottom"
						align="end"
						sideOffset={4}
						trigger={(open) => (
							<IconButton label="File controls" round aria-expanded={open}>
								<MoreHorizontal size={16} />
							</IconButton>
						)}
					>
						{() => (
							<div role="group" aria-label="File controls" className="flex items-center gap-0.5 p-0.5">
								{controls}
							</div>
						)}
					</Popover>
				</div>
				<OpenInButton path={full} line={line} project={thread?.projectCwd ?? cwd} threadId={threadId} />
			</header>
			{compare && shownBase?.error ? (
				<div role="status" className="border-t border-line px-3 py-2 text-sm text-secondary">
					<button type="button" className="hover:text-ink" onClick={() => setRetry((r) => r + 1)}>
						Could not load changes. Try again
					</button>
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 border-t border-line">
				<div className="relative flex min-h-0 min-w-0 flex-1">
				{/* Focusable, so a click in the code puts the keyboard (scrolling, Mod+F) in the tab. */}
				<div ref={body} tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto outline-none">
					{error && diff && highlighter ? (
						<FileDiff fileDiff={diff} options={diffOptions} disableWorkerPool />
					) : error ? (
						<Notice title="Could not open file" detail={error} />
					) : !read ? null : read.binary ? (
						<Notice title="Binary file not shown" detail="Open it in another app to see it." />
					) : read.tooLarge ? (
						<Notice title="This file is too large to preview in the side panel" detail="Open it in another app to see it." />
					) : !file || !highlighter || (compare && !shownBase) ? null : diff ? (
						<FileDiff fileDiff={diff} options={diffOptions} disableWorkerPool selectedLines={selected} />
					) : (
						<File file={file} options={fileOptions} disableWorkerPool selectedLines={selected} />
					)}
				</div>
				{finding ? (
					<FindBar
						root={body}
						file
						onClose={() => {
							setFinding(false);
							body.current?.focus();
						}}
					/>
				) : null}
				</div>
				{treeShown && cwd ? (
					<div className="flex w-64 shrink-0 border-l border-line">
						<FilesTree
							threadId={threadId}
							cwd={cwd}
							activePath={full}
							compare={compare ?? showable}
							onOpen={(next, keep, changed) =>
								openFileTab(threadId, next, undefined, keep, changed ? (compare ?? showable ?? { scope: "unstaged" }) : undefined)
							}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}
