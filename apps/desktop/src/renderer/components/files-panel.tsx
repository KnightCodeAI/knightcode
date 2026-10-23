/**
 * Codex's file panel (26.1016 `review-file-tree-side-pane`, `review-file-source-item`): the workspace tree beside a
 * file tab, and the "Open file" tab that is the tree beside no file yet. The tree has Codex's two sections, the
 * comparison's changed files and all of the cwd, each a top-level folder of one @pierre/trees model (as Codex builds
 * them); a folder of All files is listed (`file/list`) when it opens, and a filter searches the workspace instead.
 */

import type { DiffFile, ResultOf } from "@knightcode/app-server-protocol";
import type { FileTreeSortEntry, GitStatus } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import { matches } from "../keys.ts";
import { setPanel, showChanges, useStore } from "../store.ts";
import { Folders, List, Search, X } from "./icons.tsx";
import { IconButton } from "./button.tsx";

const CHANGED = "Changed files";
const ALL = "All files";

/** A path under a root, with the root's own separator. */
export function joinPath(root: string, relative: string): string {
	const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
	return `${root.replace(/[\\/]+$/, "")}${separator}${relative.split("/").join(separator)}`;
}

/** `path` relative to `root`, `/`-separated; undefined outside it. Windows paths compare without case. */
export function relativeTo(root: string, path: string): string | undefined {
	const normal = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
	const r = normal(root);
	const p = normal(path);
	const windows = /^[a-zA-Z]:/.test(r) || r.startsWith("//");
	return (windows ? p.toLowerCase() : p).startsWith(`${windows ? r.toLowerCase() : r}/`) ? p.slice(r.length + 1) : undefined;
}

/** Changed files first, then All files; within a section folders first, then by name as the eye reads digits. */
export function sectionOrder(a: FileTreeSortEntry, b: FileTreeSortEntry): number {
	const rank = (entry: FileTreeSortEntry) => (entry.segments[0] === CHANGED ? 0 : 1);
	if (rank(a) !== rank(b)) return rank(a) - rank(b);
	if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
	return a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: "base" });
}

const STATUS: Record<DiffFile["status"], GitStatus> = {
	added: "added",
	deleted: "deleted",
	modified: "modified",
	renamed: "renamed",
	typeChanged: "modified",
};

/** Codex's section rows: a chevron and the label, no folder icon, the label in the row's own colour. */
const FILES_TREE_CSS = `
	[data-type='item'][aria-level='1'] [data-item-section='icon'] {
		display: none;
	}
	[data-file-tree-sticky-row='true'] {
		background-color: var(--kc-bg-surface);
	}
	[data-file-tree-virtualized-scroll='true'] {
		scrollbar-gutter: auto;
	}
`;

type Entry = ResultOf<"file/list">["entries"][number];

/** The comparison's changed files (Codex's default, the Index: unstaged changes), again after a turn or a return. */
function useChangedFiles(threadId: string) {
	const version = useStore((s) => s.diffVersion[threadId] ?? 0);
	const [read, setRead] = useState<{ root: string; files: DiffFile[] }>();
	useEffect(() => {
		let live = true;
		const load = () =>
			client.request("thread/diff/read", { threadId, scope: "unstaged" }).then(
				(r) => live && setRead({ root: r.root, files: r.files }),
				// Outside git, or a failed read: no Changed files section to show.
				() => live && setRead(undefined),
			);
		void load();
		window.addEventListener("focus", load);
		return () => {
			live = false;
			window.removeEventListener("focus", load);
		};
	}, [threadId, version]);
	return read;
}

/** A filter's workspace search (`file/search`): undefined while it runs. */
function useSearch(cwd: string, query: string) {
	const [found, setFound] = useState<{ query: string; paths: string[] }>();
	useEffect(() => {
		if (!query.trim()) return;
		let live = true;
		const timer = setTimeout(() => {
			void client.request("file/search", { cwd, query: query.trim(), limit: 200 }).then(
				(r) => live && setFound({ query, paths: r.files.map((f) => f.path) }),
				() => live && setFound({ query, paths: [] }),
			);
		}, 120);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [cwd, query]);
	return found?.query === query ? found.paths : undefined;
}

export interface FilesTreeProps {
	threadId: string;
	cwd: string;
	/** The file the tab beside shows, selected in the tree. */
	activePath?: string;
	/** The "Open file" tab focuses the filter, as Codex's does with no file open. */
	autoFocus?: boolean;
	/** A file chosen: `keep` for a double click (a kept tab), else a preview tab. */
	onOpen: (path: string, keep: boolean) => void;
}

/** Codex's filter field: a search icon, the input, and a clear button while it holds text. */
function Filter({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
	return (
		<div className="relative flex h-7 w-full items-center gap-1.5 rounded-lg border border-line bg-soft-alt text-[13px] leading-[18px]">
			<Search size={14} className="ms-2 shrink-0 text-tertiary" />
			<label htmlFor="kc-files-filter" className="sr-only">
				Filter files
			</label>
			<input
				id="kc-files-filter"
				// biome-ignore lint/a11y/noAutofocus: Codex focuses the filter of an "Open file" tab.
				autoFocus={autoFocus}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (value && matches(e.nativeEvent, "desktop.picker.dismiss")) {
						e.stopPropagation();
						onChange("");
					}
				}}
				placeholder="Filter files…"
				spellCheck={false}
				className="min-w-0 flex-1 bg-transparent pe-1.5 text-ink outline-none placeholder:text-tertiary"
			/>
			{value ? (
				<button
					type="button"
					aria-label="Clear file filter"
					onClick={() => onChange("")}
					className="me-1.5 flex size-4 items-center justify-center text-tertiary hover:text-ink"
				>
					<X size={12} />
				</button>
			) : null}
		</div>
	);
}

/** One @pierre/trees model over both sections; `cwd` and `root` key it, so a new thread starts a new one. */
function SectionedTree({
	threadId,
	cwd,
	changed,
	activePath,
	onOpen,
}: {
	threadId: string;
	cwd: string;
	changed?: { root: string; files: DiffFile[] };
	activePath?: string;
	onOpen: FilesTreeProps["onOpen"];
}) {
	const known = useRef(new Set<string>([`${CHANGED}/`, `${ALL}/`]));
	const listed = useRef(new Set<string>());
	const open = useRef(onOpen);
	open.current = onOpen;
	const changedRoot = useRef(changed?.root);
	changedRoot.current = changed?.root;
	const changes = useRef(new Map<string, DiffFile>());
	changes.current = new Map((changed?.files ?? []).map((f) => [`${CHANGED}/${f.path}`, f]));

	/** Where a tree path points on disk: a changed file under the repository's root, the rest under the cwd. */
	const pathOf = (treePath: string) => {
		if (treePath.startsWith(`${CHANGED}/`) && changedRoot.current)
			return joinPath(changedRoot.current, treePath.slice(CHANGED.length + 1));
		if (treePath.startsWith(`${ALL}/`)) return joinPath(cwd, treePath.slice(ALL.length + 1));
		return undefined;
	};

	const { model } = useFileTree({
		paths: [...known.current],
		initialExpandedPaths: [`${CHANGED}/`, `${ALL}/`],
		flattenEmptyDirectories: false,
		sort: sectionOrder,
		icons: { set: "complete", colored: true },
		itemHeight: 29,
		stickyFolders: true,
		unsafeCSS: FILES_TREE_CSS,
		onSelectionChange: (paths) => {
			const path = paths[0];
			if (!path || path.endsWith("/")) return;
			const target = pathOf(path);
			if (target) open.current(target, false);
		},
	});

	/** Adds and removes paths under one prefix so the tree holds exactly `paths` there, keeping what it opened. */
	const sync = (prefix: string, paths: string[]) => {
		const wanted = new Set(paths);
		const operations: { type: "add" | "remove"; path: string }[] = [];
		for (const path of known.current)
			if (path.startsWith(prefix) && path !== prefix && !wanted.has(path)) operations.push({ type: "remove", path });
		for (const path of wanted) if (!known.current.has(path)) operations.push({ type: "add", path });
		if (operations.length === 0) return;
		for (const op of operations) op.type === "add" ? known.current.add(op.path) : known.current.delete(op.path);
		model.batch(
			operations.map((op) => (op.type === "add" ? { type: "add", path: op.path } : { type: "remove", path: op.path, recursive: true })),
		);
	};

	// Changed files, their folders open as Codex keeps them, with git's colours.
	useEffect(() => {
		const files = changed?.files ?? [];
		const paths = files.flatMap((f) => {
			const segments = f.path.split("/");
			return [...segments.slice(0, -1).map((_, i) => `${CHANGED}/${segments.slice(0, i + 1).join("/")}/`), `${CHANGED}/${f.path}`];
		});
		sync(`${CHANGED}/`, paths);
		for (const path of paths) if (path.endsWith("/")) (model.getItem(path) as { expand?: () => void } | null)?.expand?.();
		model.setGitStatus(files.map((f) => ({ path: `${CHANGED}/${f.path}`, status: STATUS[f.status] ?? "modified" })));
	}, [changed, model]);

	// All files: the cwd's entries now, a folder's when it opens; kept until a return to the window lists them again.
	useEffect(() => {
		let live = true;
		const list = async (folder: string) => {
			const result = await client.request("file/list", { threadId, ...(folder ? { path: folder } : {}) }).catch(() => undefined);
			if (!live || !result) return;
			listed.current.add(folder);
			const prefix = folder ? `${ALL}/${folder}/` : `${ALL}/`;
			const entries = result.entries.map((e: Entry) => `${ALL}/${e.path}${e.type === "directory" ? "/" : ""}`);
			// Only this folder's own entries: a listed subfolder keeps its children.
			const own = [...known.current].filter(
				(p) => p.startsWith(prefix) && p !== prefix && !p.slice(prefix.length).replace(/\/$/, "").includes("/"),
			);
			const wanted = new Set(entries);
			const operations = [
				...own.filter((p) => !wanted.has(p)).map((path) => ({ type: "remove" as const, path, recursive: true })),
				...entries.filter((p) => !known.current.has(p)).map((path) => ({ type: "add" as const, path })),
			];
			for (const op of operations) op.type === "add" ? known.current.add(op.path) : known.current.delete(op.path);
			if (operations.length) model.batch(operations);
		};
		void list("");
		// A folder opened in the tree is listed the first time; the model says which are open.
		const unsubscribe = model.subscribe(() => {
			for (const path of known.current) {
				if (!path.startsWith(`${ALL}/`) || !path.endsWith("/") || path === `${ALL}/`) continue;
				const folder = path.slice(ALL.length + 1, -1);
				if (listed.current.has(folder)) continue;
				const item = model.getItem(path) as { isExpanded?: () => boolean } | null;
				if (item?.isExpanded?.()) {
					listed.current.add(folder);
					void list(folder);
				}
			}
		});
		const refresh = () => {
			for (const folder of listed.current) void list(folder);
		};
		window.addEventListener("focus", refresh);
		return () => {
			live = false;
			unsubscribe();
			window.removeEventListener("focus", refresh);
		};
	}, [model, threadId]);

	// The file beside, selected: its Changed files row when it has one, else its All files row.
	useEffect(() => {
		if (!activePath) return;
		const inChanges = changed ? relativeTo(changed.root, activePath) : undefined;
		const inAll = relativeTo(cwd, activePath);
		const target =
			inChanges !== undefined && known.current.has(`${CHANGED}/${inChanges}`)
				? `${CHANGED}/${inChanges}`
				: inAll !== undefined && known.current.has(`${ALL}/${inAll}`)
					? `${ALL}/${inAll}`
					: undefined;
		for (const path of model.getSelectedPaths()) if (path !== target) model.getItem(path)?.deselect();
		if (target && !model.getItem(target)?.isSelected()) model.getItem(target)?.select();
	}, [activePath, changed, cwd, model]);

	return (
		<FileTree
			model={model}
			className="kc-tree min-h-0 flex-1"
			// A double click keeps the file's tab (Codex's onDoubleClick), the click before it having opened it.
			onDoubleClick={() => {
				const path = model.getFocusedPath();
				const target = path && !path.endsWith("/") ? pathOf(path) : undefined;
				if (target) open.current(target, true);
			}}
		/>
	);
}

/** Search results as a tree of their folders, all open (Codex's filtered tree). */
function ResultsTree({ cwd, paths, onOpen }: { cwd: string; paths: string[]; onOpen: FilesTreeProps["onOpen"] }) {
	const open = useRef(onOpen);
	open.current = onOpen;
	const { model } = useFileTree({
		paths,
		initialExpansion: "open",
		flattenEmptyDirectories: false,
		icons: { set: "complete", colored: true },
		itemHeight: 29,
		unsafeCSS: FILES_TREE_CSS,
		onSelectionChange: (selected) => {
			const path = selected[0];
			if (path && !path.endsWith("/")) open.current(joinPath(cwd, path), false);
		},
	});
	return <FileTree model={model} className="kc-tree min-h-0 flex-1" />;
}

/** The tree pane: Codex's filter, "All changes", then the sections, or the filter's results. */
export function FilesTree({ threadId, cwd, activePath, autoFocus, onOpen }: FilesTreeProps) {
	const [query, setQuery] = useState("");
	const changed = useChangedFiles(threadId);
	const results = useSearch(cwd, query);
	const searching = query.trim().length > 0;
	const resultsKey = useMemo(() => results?.join("\0") ?? "", [results]);
	return (
		<div className="flex h-full min-h-0 w-full flex-col px-1">
			<div className="px-1 pt-2 pb-1">
				<Filter value={query} onChange={setQuery} autoFocus={autoFocus} />
			</div>
			{searching ? (
				results === undefined ? (
					<div className="px-2 py-2 text-[13px] text-tertiary" role="status" title="Searching files…">
						Searching…
					</div>
				) : results.length === 0 ? (
					<div className="px-2 py-2 text-[13px] text-tertiary">No matching files</div>
				) : (
					<ResultsTree key={resultsKey} cwd={cwd} paths={results} onOpen={onOpen} />
				)
			) : (
				<>
					<button
						type="button"
						onClick={() => showChanges(threadId)}
						className="flex h-[29px] shrink-0 items-center gap-2 rounded-lg px-2 text-[13px] text-ink hover:bg-ghost-hover"
					>
						<List size={14} className="shrink-0 text-secondary" />
						All changes
					</button>
					<SectionedTree
						key={`${cwd}\0${changed?.root ?? ""}`}
						threadId={threadId}
						cwd={cwd}
						changed={changed}
						activePath={activePath}
						onOpen={onOpen}
					/>
				</>
			)}
		</div>
	);
}

/** Codex's Toggle file tree, remembered for every file tab. */
export function TreeToggle() {
	const shown = useStore((s) => s.panel.fileTree !== false);
	return (
		<IconButton label="Toggle file tree" aria-pressed={shown} onClick={() => setPanel({ fileTree: !shown })}>
			<Folders size={16} className={shown ? "text-[var(--kc-accent)]" : undefined} />
		</IconButton>
	);
}

/** Codex's "Open file" tab: the tree beside an empty view until a file is chosen. */
export function FilesTab({
	threadId,
	onOpen,
}: {
	threadId: string;
	onOpen: (path: string, keep: boolean) => void;
}) {
	const cwd = useStore((s) => s.held[threadId]?.thread.cwd ?? "");
	const shown = useStore((s) => s.panel.fileTree !== false);
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Open file">
			<header className="relative z-20 flex shrink-0 items-center justify-end gap-1.5 p-2">
				<div className="kc-capsule inline-flex h-8 shrink-0 items-center rounded-full p-0.5">
					<TreeToggle />
				</div>
			</header>
			<div className="flex min-h-0 flex-1 border-t border-line">
				<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
					<Folders size={40} strokeWidth={1} className="mb-2 text-ink/85" />
					<div className="text-[15px] leading-6 font-semibold text-ink">Open file</div>
					<div className="text-[13px] leading-5 text-tertiary">Select a file from the workspace tree</div>
				</div>
				{shown && cwd ? (
					<div className="flex w-64 shrink-0 border-l border-line">
						<FilesTree threadId={threadId} cwd={cwd} autoFocus onOpen={onOpen} />
					</div>
				) : null}
			</div>
		</div>
	);
}
