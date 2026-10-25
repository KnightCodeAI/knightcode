/**
 * A file tab (desktop-shell.md section 9.6): a toolbar of capsules (the path as a breadcrumb; the comparison,
 * "Unstaged ▾" beside Hide changes, or Show changes while they are hidden; the change navigation; the diff layout and
 * Toggle file tree; the Open split button) over the file in @pierre/diffs (12px code on 22px lines, the Changes pane's
 * theme), its changes in the comparison drawn in place, the whole file expanded, and the workspace tree on the right.
 * The server reads the file (file/read) and the comparison's side of it (thread/diff/read, thread/diff/file), as it
 * reads every file the desktop shows. The file is editable: edits are the tab's draft (the store's, so they outlive
 * this view), written three seconds after the last one or on Mod+S (file/write, refused once the file has moved).
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
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import { EditProvider, FileDiff, File } from "@pierre/diffs/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import diffOverrides from "../diff-overrides.css?raw";
import { basename, samePath } from "../format.ts";
import { matches } from "../keys.ts";
import {
	errorText,
	type FileComparison,
	type FileDraft,
	openFileTab,
	saveFileDraft,
	selectPreferences,
	setFileComparison,
	setFileDraft,
	setPanel,
	useStore,
} from "../store.ts";
import { IconButton } from "./button.tsx";
import { highlighterReady } from "./changes.tsx";
import { FilesTree, FolderTree, joinPath, relativeTo, TreeToggle } from "./files-panel.tsx";
import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Code,
	Columns2,
	Eye,
	FileDiff as FileDiffIcon,
	File as FileIcon,
	MoreHorizontal,
	Rows2,
	X,
} from "./icons.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuTrigger } from "./menu.tsx";
import { Markdown } from "./markdown.tsx";
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

/**
 * `title`: the whole path, shown on hover, since a narrow toolbar clips the crumbs. `ancestor` draws a folder's crumb,
 * which opens that folder's tree.
 */
export function Breadcrumb({
	segments,
	title,
	ancestor,
}: {
	segments: string[];
	title?: string;
	ancestor?: (segment: string, index: number) => ReactNode;
}) {
	return (
		<div className="kc-capsule flex h-8 min-w-0 shrink items-center rounded-full p-0.5">
			<nav aria-label="File path" title={title} className="flex h-full min-w-0 items-center overflow-hidden px-2">
				<ol className="flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-[18.5px] text-secondary select-text">
					{segments.map((segment, i) => {
						const last = i === segments.length - 1;
						return (
							<li key={i} className={`flex items-center gap-1 ${last ? "min-w-0" : "shrink-0"}`}>
								{last ? (
									<span className="min-w-0 truncate font-medium text-ink">{segment}</span>
								) : ancestor ? (
									ancestor(segment, i)
								) : (
									<span className="whitespace-nowrap">{segment}</span>
								)}
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

/** Autosave: an edit is written this long after the last one. */
const AUTOSAVE_MS = 3000;

const createEditor: EditorFactory<undefined, undefined> = (type, options, key) => new Editor(type, options, key);

/** The comparison's changed files first, so the default is the first that holds the file. */
const COMPARISONS: FileComparison["scope"][] = ["unstaged", "uncommitted", "branch"];

/**
 * The comparison's side of a file: its text at the comparison's base, "" for a file the comparison adds, and null
 * when the comparison does not change it (the baseline is then the file itself).
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
 * The comparison Show changes picks: the first that changes the file, none when none does.
 * ponytail: up to three whole diff reads per file; a server call that answers for one path if this shows up slow.
 */
async function defaultComparison(threadId: string, path: string): Promise<FileComparison | undefined> {
	for (const scope of COMPARISONS) {
		const read = await client.request("thread/diff/read", { threadId, scope }).catch(() => undefined);
		if (read?.files.some((f) => samePath(joinPath(read.root, f.path), path))) return { scope };
	}
	return undefined;
}

/** The changed sections of a diff, in order (the navigation counts these): runs of added and deleted lines. */
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

/** The comparison capsule: the picker (Index, HEAD, a branch) joined to Hide changes. */
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

/** The change navigation: previous, the position ("2/3", or the count outside a change), next. */
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

/** A text's line count as an editor numbers it: a final newline starts no line of its own. */
export function lineCount(text: string): number {
	return Math.max(1, text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
}

/**
 * Go to line (Mod+L) over a pierre file: a field in the file's top corner with the valid range beside it and
 * a round close button on its corner. Enter goes; Escape, the button or a click elsewhere closes it.
 */
function GoToLine({ count, onGo, onClose }: { count: number; onGo: (line: number) => void; onClose: () => void }) {
	const [value, setValue] = useState("");
	const [invalid, setInvalid] = useState(false);
	return (
		<div className="pointer-events-none absolute inset-x-4 top-4 z-30 flex justify-end">
			<form
				role="search"
				aria-label="Go to line"
				className="pointer-events-auto relative flex max-w-full min-w-0 items-center gap-1.5 rounded-[9px] border border-line bg-surface p-1 shadow-[0_4px_8px_rgba(0,0,0,0.075),0_6px_18px_rgba(0,0,0,0.075)]"
				onSubmit={(e) => {
					e.preventDefault();
					const line = Number(value.trim());
					if (!/^\d+$/.test(value.trim()) || line < 1 || line > count) setInvalid(true);
					else onGo(line);
				}}
				onKeyDown={(e) => {
					if (!matches(e.nativeEvent, "desktop.picker.dismiss")) return;
					e.preventDefault();
					e.stopPropagation();
					onClose();
				}}
				onBlur={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
				}}
			>
				<label htmlFor="kc-go-to-line" className="sr-only">
					Go to line
				</label>
				<input
					id="kc-go-to-line"
					// biome-ignore lint/a11y/noAutofocus: opened by its shortcut to be typed into.
					autoFocus
					inputMode="numeric"
					autoComplete="off"
					placeholder="Line"
					value={value}
					aria-invalid={invalid || undefined}
					aria-errormessage={invalid ? "kc-go-to-line-error" : undefined}
					onChange={(e) => {
						setValue(e.target.value);
						setInvalid(false);
					}}
					className={`h-7 w-[200px] min-w-0 shrink rounded-[6px] border bg-surface px-1.5 text-[13px] leading-6 text-ink outline-none placeholder:text-tertiary ${invalid ? "border-danger-text text-danger-text" : "border-line"}`}
				/>
				<span className="flex min-w-[50px] shrink-0 items-center text-[12px] leading-5 font-medium whitespace-nowrap text-tertiary">
					1–{count}
				</span>
				<span id="kc-go-to-line-error" className="sr-only">
					Enter a valid whole line number
				</span>
				<button
					type="button"
					aria-label="Close go to line"
					onClick={onClose}
					className="absolute end-0 top-0 flex size-5 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-tertiary text-surface hover:bg-ink rtl:-translate-x-1/2"
				>
					<X size={10} />
				</button>
			</form>
		</div>
	);
}

export function FileTab({
	threadId,
	path,
	line,
	used,
	compare,
	draft,
}: {
	threadId: string;
	path: string;
	line?: number;
	used: number;
	compare?: FileComparison;
	draft?: FileDraft;
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
	const [goingTo, setGoingTo] = useState(false);
	const [jump, setJump] = useState<number>();
	const [preview, setPreview] = useState<boolean>();
	const markdown = /\.(md|markdown|mdx)$/i.test(path);
	const previewing = markdown && (preview ?? !compare);
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

	// What the editor was given: the file as read, or the tab's draft when it opens with one. It changes only when the
	// file changes elsewhere while nothing is unsaved (a new `revision` gives the editor the new text); the user's own
	// edits stay in the editor, which owns them. `disk` is the file as last read or written, which edits are made over.
	const [shown, setShown] = useState<{ text: string; revision: number }>();
	const disk = useRef<{ text?: string; mtimeMs: number }>(undefined);
	// The editor's text as last edited: an editor drawn afresh (changes shown or hidden, another comparison) starts
	// from what the user has, not from the text the tab first read.
	const typed = useRef<string>(undefined);
	const unsaved = useRef(draft);
	unsaved.current = draft;
	useEffect(() => {
		if (read?.text === undefined) return;
		const text = read.text;
		const pending = unsaved.current;
		if (pending) {
			// Unsaved edits stay: a save refuses once the file has moved under them.
			disk.current ??= { text: read.mtimeMs === pending.mtimeMs ? text : undefined, mtimeMs: pending.mtimeMs };
			setShown((s) => s ?? { text: pending.text, revision: 1 });
			return;
		}
		const known = disk.current?.text;
		disk.current = { text, mtimeMs: read.mtimeMs };
		if (shown && (shown.text === text || known === text)) return;
		typed.current = undefined;
		setShown({ text, revision: (shown?.revision ?? 0) + 1 });
	}, [read]);

	const autosave = useRef<ReturnType<typeof setTimeout>>(undefined);
	const save = async () => {
		clearTimeout(autosave.current);
		autosave.current = undefined;
		const saved = await saveFileDraft(threadId, path);
		if (saved) disk.current = saved;
	};
	const edited = (text: string) => {
		typed.current = text;
		const known = disk.current;
		if (!known) return;
		setFileDraft(threadId, path, text === known.text ? undefined : { text, mtimeMs: known.mtimeMs });
		clearTimeout(autosave.current);
		autosave.current = setTimeout(() => void save(), AUTOSAVE_MS);
	};
	// Leaving the tab (another tab, another thread) writes what was waiting for the autosave.
	useEffect(
		() => () => {
			if (autosave.current === undefined) return;
			clearTimeout(autosave.current);
			void saveFileDraft(threadId, path);
		},
		[threadId, path],
	);

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

	// The same object while the text is the same, so a reload of an unchanged file redraws nothing. Made again (from the
	// typed text) only where a new editor is drawn: changes shown or hidden, another comparison or side.
	const file = useMemo(
		() => (shown ? { name: basename(full), contents: typed.current ?? shown.text } : undefined),
		[full, shown, baseKey, shownBase?.text],
	);
	const diff = useMemo(() => {
		const text = shownBase?.text;
		if (typeof text !== "string") return undefined;
		const name = basename(path);
		// A file the comparison deletes cannot be read: its old text against nothing.
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
	// it was opened with: scrolled to the middle once, so a reload after an edit leaves the
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
	const segments = crumbs(full, cwd);
	const marked = jump ?? line;
	const selected = marked ? { start: marked, end: marked, side: "additions" as const } : null;
	const controls = (
		<>
			{/* A Markdown file reads rendered until its source is asked for, or its changes shown. */}
			{markdown ? (
				<IconButton label={previewing ? "View source" : "View preview"} round onClick={() => setPreview(!previewing)}>
					{previewing ? <Code size={16} /> : <Eye size={16} />}
				</IconButton>
			) : null}
			{/* The icon shows the layout in use and the label the one a click switches to. */}
			{compare && !previewing ? (
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
			// Mod+S writes the edits now; Mod+L goes to a line. (Mod+F in the editor is its own search panel.)
			onKeyDown={(e) => {
				if (matches(e.nativeEvent, "desktop.file.save")) {
					e.preventDefault();
					void save();
				} else if (matches(e.nativeEvent, "desktop.file.goToLine") && file && !previewing) {
					e.preventDefault();
					setGoingTo(true);
				}
			}}
		>
			<header className="@container/file-header relative z-20 flex shrink-0 items-center gap-1.5 p-2">
				<Breadcrumb
					segments={segments}
					title={full}
					ancestor={
						relativeTo(cwd, full) === undefined
							? undefined
							: (segment, i) => (
									<Popover
										side="bottom"
										sideOffset={6}
										className="flex h-80 w-72 flex-col bg-[var(--kc-bg-panel)]!"
										trigger={(open) => (
											<button
												type="button"
												aria-expanded={open}
												className="rounded-sm whitespace-nowrap outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--kc-accent)]"
											>
												{segment}
											</button>
										)}
									>
										{(close) => (
											<FolderTree
												threadId={threadId}
												cwd={cwd}
												folder={segments.slice(1, i + 1).join("/")}
												activePath={full}
												onOpen={(next) => {
													close();
													openFileTab(threadId, next);
												}}
											/>
										)}
									</Popover>
								)
					}
				/>
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
				{compare && diff && !previewing ? <ChangeNavigation count={blocks.length} active={active} onGo={go} /> : null}
				{/* Under 625px of toolbar the file controls fold into one button that opens them. */}
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
				{goingTo && file ? (
					<GoToLine
						count={lineCount(draft?.text ?? file.contents)}
						onClose={() => setGoingTo(false)}
						onGo={(to) => {
							setGoingTo(false);
							setJump(to);
							centerRow(body.current, `[data-line="${to}"]:not([data-line-type="change-deletion"])`);
						}}
					/>
				) : null}
				<div ref={body} className="min-h-0 min-w-0 flex-1 overflow-auto">
					{error && diff && highlighter ? (
						<FileDiff fileDiff={diff} options={diffOptions} disableWorkerPool />
					) : error ? (
						<Notice title="Could not open file" detail={error} />
					) : !read ? null : read.binary ? (
						<Notice title="Binary file not shown" detail="Open it in another app to see it." />
					) : read.tooLarge ? (
						<Notice title="This file is too large to preview in the side panel" detail="Open it in another app to see it." />
					) : previewing && file ? (
						<div className="mx-auto max-w-3xl px-6 py-5">
							<Markdown text={draft?.text ?? file.contents} />
						</div>
					) : !file || !shown || !highlighter || (compare && !shownBase) ? null : (
						<EditProvider createEditor={createEditor}>
							{diff ? (
								<FileDiff
									key={`${shown.revision}:${baseKey}`}
									fileDiff={diff}
									options={diffOptions}
									disableWorkerPool
									selectedLines={selected}
									edit
									onEditChange={(e) => edited(e.file.contents)}
									onEditComplete={() => "reject"}
								/>
							) : (
								<File
									key={shown.revision}
									file={file}
									options={fileOptions}
									disableWorkerPool
									selectedLines={selected}
									edit
									onEditChange={(e) => edited(e.file.contents)}
									onEditComplete={() => "reject"}
								/>
							)}
						</EditProvider>
					)}
				</div>
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
