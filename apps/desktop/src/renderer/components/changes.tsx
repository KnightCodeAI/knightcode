/**
 * The Changes pane (desktop-shell.md section 9.6), shaped after Codex's: a source capsule with totals and a
 * controls capsule, each file under a sticky header with its diff (@pierre/diffs, as Codex renders it), review
 * comments from the gutter, and a file tree on the right.
 */

import type { DiffComment, DiffFile, DiffScope, ResultOf } from "@knightcode/app-server-protocol";
import { type DiffLineAnnotation, PatchDiff } from "@pierre/diffs/react";
import {
	ChevronDown,
	ChevronRight,
	ChevronsDownUp,
	Columns2,
	ExternalLink,
	FileDiff,
	FileSearch,
	MoreHorizontal,
	PanelRight,
	RefreshCw,
	Rows2,
	Search,
	WrapText,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client, RequestError } from "../client.ts";
import diffOverrides from "../diff-overrides.css?raw";
import { matches } from "../keys.ts";
import { addComment, errorText, removeComment, toast, useStore } from "../store.ts";
import { FileIcon } from "./file-icon.tsx";
import { MenuItem, Popover } from "./popover.tsx";

type Selector = { scope: DiffScope; against?: string; commit?: string };
type Read = ResultOf<"thread/diff/read">;

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

function ControlButton({
	label,
	onClick,
	pressed,
	children,
}: {
	label: string;
	onClick?: () => void;
	pressed?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={pressed}
			onClick={onClick}
			className={`flex size-7 shrink-0 items-center justify-center rounded-full ${pressed ? "bg-info-bg text-info" : "text-desc hover:bg-ghost-hover hover:text-ink"}`}
		>
			{children}
		</button>
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
	return (
		<div className="w-full max-w-3xl min-w-0 p-1.5 font-ui">
			<div className="kc-comment overflow-hidden rounded-[12.5px] bg-soft">
				<div className="flex items-center justify-between gap-2 px-3 pt-2 pb-0.5">
					<div className="flex min-h-6 items-center gap-2.5">
						<span className="flex size-6 items-center justify-center rounded-full bg-[#5d5d5d] text-[10px] font-medium text-white">
							You
						</span>
						<span className="text-[12px] leading-4 text-desc">You</span>
					</div>
					<span className="text-[12px] leading-4 text-desc">
						Local comment on line {side === "new" ? "R" : "L"}
						{line}
					</span>
				</div>
				{body !== undefined ? (
					<div className="selectable px-3 py-3 text-[14px] leading-[22.75px] whitespace-pre-wrap text-ink">{body}</div>
				) : (
					<div className="p-3">
						<textarea
							autoFocus
							rows={1}
							value={text}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (matches(e, "desktop.composer.steer") && text.trim()) onSave?.(text.trim());
								if (matches(e, "desktop.picker.dismiss")) onCancel?.();
							}}
							placeholder="Add a comment…"
							className="block w-full resize-none bg-transparent text-[14px] leading-[22.75px] text-ink outline-none placeholder:text-desc focus-visible:outline-none"
						/>
					</div>
				)}
				<div className="flex items-center justify-end gap-2 px-3 py-2 text-[13px] text-desc">
					{body !== undefined ? (
						<button
							type="button"
							onClick={onDelete}
							className="h-6 rounded-[12.5px] bg-row px-2 text-[12px] leading-4 text-desc hover:text-ink"
						>
							Delete
						</button>
					) : (
						<>
							<button
								type="button"
								onClick={onCancel}
								className="h-6 rounded-[12.5px] px-2 text-[12px] leading-4 text-desc hover:bg-row hover:text-ink"
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={!text.trim()}
								onClick={() => onSave?.(text.trim())}
								className="h-6 rounded-[12.5px] border border-hairline bg-white px-2 text-[12px] leading-4 text-[#2d2d2d] disabled:opacity-50"
							>
								Comment
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

type Annotation = { comment?: DiffComment };

function FileSection({
	threadId,
	cwd,
	file,
	selector,
	options,
	collapsed,
	onCollapse,
	onAction,
}: {
	threadId: string;
	cwd: string;
	file: DiffFile;
	selector: Selector;
	options: { wrap: boolean; split: boolean; wordDiffs: boolean };
	collapsed: boolean;
	onCollapse: () => void;
	onAction: (action: "stage" | "unstage" | "revert", file: DiffFile) => void;
}) {
	const comments = useStore((s) => s.comments[threadId]);
	const [draft, setDraft] = useState<{ side: "old" | "new"; start: number; end: number } | undefined>();
	const mine = useMemo(
		() => (comments ?? []).filter((c) => c.path === file.path && scopeOf(c) === selector.scope),
		[comments, file.path, selector.scope],
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
	const full = `${cwd.replace(/[\\/]+$/, "")}/${file.path}`;
	const scope = selector.scope;
	return (
		<div className="group/file-diff flex flex-col pb-0.5">
			<div className="sticky top-0 z-10 bg-surface">
				<div className="flex items-center gap-2 border-b border-hairline py-2 ps-3 pe-2 text-[14px] leading-[21px]">
					<div className="flex min-w-0 flex-1 items-center gap-2 ps-1">
						<FileIcon path={file.path} />
						<button
							type="button"
							onClick={onCollapse}
							title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
							className="min-w-0 truncate text-start"
						>
							<span className="text-desc">{dirOf(file.path)}</span>
							<span className="text-ink">{nameOf(file.path)}</span>
						</button>
					</div>
					<div className="ms-auto flex shrink-0 items-center gap-1">
						<Totals additions={file.additions} deletions={file.deletions} className="ms-1 me-1 text-[14px]" />
						<button
							type="button"
							title="Open in"
							aria-label="Open in"
							onClick={() =>
								void client.host("host/shell/openPath", { path: full }).catch((e: unknown) => toast(errorText(e)))
							}
							className="flex size-5 items-center justify-center rounded-full text-desc hover:text-ink"
						>
							<ExternalLink size={16} strokeWidth={1.75} />
						</button>
						<Popover
							side="bottom"
							align="right"
							trigger={(open) => (
								<button
									type="button"
									title="File actions"
									aria-label="File actions"
									className={`flex size-5 items-center justify-center rounded-full ${open ? "text-ink" : "text-desc hover:text-ink"}`}
								>
									<MoreHorizontal size={16} />
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
									<div className="w-[212px]">
										{item("Copy path", () => void client.host("host/clipboard/writeText", { text: full }))}
										{item(
											"Open in editor",
											() =>
												void client
													.host("host/shell/openPath", { path: full })
													.catch((e: unknown) => toast(errorText(e))),
										)}
										{item(collapsed ? "Expand file" : "Collapse file", onCollapse)}
										{scope === "committed" ? null : <div className="my-1 border-t border-hairline" />}
										{scope === "uncommitted" || scope === "unstaged"
											? item("Stage file", () => onAction("stage", file))
											: null}
										{scope === "staged" ? item("Unstage file", () => onAction("unstage", file)) : null}
										{scope !== "staged" && scope !== "committed"
											? item(scope === "lastTurn" ? "Undo file" : "Revert file", () => onAction("revert", file), true)
											: null}
									</div>
								);
							}}
						</Popover>
					</div>
				</div>
			</div>
			{collapsed ? null : file.binary || file.tooLarge || file.hunks.length === 0 ? (
				<div className="px-4 py-3 text-[13px] text-desc">
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
					patch={patchOf(file)}
					disableWorkerPool
					options={{
						theme: { dark: "pierre-dark", light: "pierre-light" },
						themeType: document.documentElement.dataset.theme === "light" ? "light" : "dark",
						diffStyle: options.split ? "split" : "unified",
						diffIndicators: "bars",
						overflow: options.wrap ? "wrap" : "scroll",
						hunkSeparators: "line-info",
						lineDiffType: options.wordDiffs ? "word-alt" : "none",
						disableFileHeader: true,
						enableGutterUtility: true,
						unsafeCSS: diffOverrides,
						onGutterUtilityClick: (range) =>
							setDraft({
								side: range.side === "deletions" ? "old" : "new",
								start: Math.min(range.start, range.end ?? range.start),
								end: Math.max(range.start, range.end ?? range.start),
							}),
					}}
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

interface TreeNode {
	name: string;
	path: string;
	file?: DiffFile;
	children: TreeNode[];
}

function buildTree(files: DiffFile[]): TreeNode[] {
	const root: TreeNode = { name: "", path: "", children: [] };
	for (const file of files) {
		const parts = file.path.split("/");
		let node = root;
		parts.forEach((part, i) => {
			const path = parts.slice(0, i + 1).join("/");
			let child = node.children.find((c) => c.name === part && !c.file === i < parts.length - 1);
			if (!child) {
				child = { name: part, path, children: [], ...(i === parts.length - 1 ? { file } : {}) };
				node.children.push(child);
			}
			node = child;
		});
	}
	// One-child folder chains read as one row ("src/app"), as in Codex's tree.
	const squash = (node: TreeNode): TreeNode => {
		let current = node;
		while (!current.file && current.children.length === 1 && !current.children[0]!.file) {
			const only = current.children[0]!;
			current = { ...only, name: current.name ? `${current.name}/${only.name}` : only.name };
		}
		return { ...current, children: current.children.map(squash) };
	};
	return root.children.map(squash).sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)));
}

function Tree({
	nodes,
	depth,
	selected,
	onSelect,
}: {
	nodes: TreeNode[];
	depth: number;
	selected?: string;
	onSelect: (path: string) => void;
}) {
	const [closed, setClosed] = useState<Set<string>>(new Set());
	return (
		<>
			{nodes.map((node) =>
				node.file ? (
					<button
						key={node.path}
						type="button"
						onClick={() => onSelect(node.path)}
						style={{ paddingInlineStart: 8 + depth * 12 }}
						className={`flex h-8 w-full items-center gap-2 rounded-lg pe-1.5 text-start text-[13px] ${selected === node.path ? "bg-ghost-hover text-ink" : "text-ink hover:bg-ghost-hover"}`}
					>
						<FileIcon path={node.path} />
						<span className="min-w-0 flex-1 truncate">{node.name}</span>
						<Totals additions={node.file.additions} deletions={node.file.deletions} className="text-[11px]" />
					</button>
				) : (
					<div key={node.path}>
						<button
							type="button"
							onClick={() =>
								setClosed((set) => {
									const next = new Set(set);
									if (next.has(node.path)) next.delete(node.path);
									else next.add(node.path);
									return next;
								})
							}
							style={{ paddingInlineStart: 4 + depth * 12 }}
							className="flex h-8 w-full items-center gap-1.5 rounded-lg text-start text-[13px] text-ink hover:bg-ghost-hover"
						>
							{closed.has(node.path) ? (
								<ChevronRight size={14} className="text-desc" />
							) : (
								<ChevronDown size={14} className="text-desc" />
							)}
							<span className="truncate">{node.name}</span>
						</button>
						{closed.has(node.path) ? null : (
							<Tree nodes={node.children} depth={depth + 1} selected={selected} onSelect={onSelect} />
						)}
					</div>
				),
			)}
		</>
	);
}

function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
			<FileDiff size={64} strokeWidth={1.25} className="mb-3 -rotate-6 text-ink/85" />
			<div className="text-[16px] leading-6 font-semibold text-ink">{title}</div>
			<div className="text-[13px] leading-5 text-desc">{detail}</div>
			{action}
		</div>
	);
}

export function ChangesPane({ threadId }: { threadId: string }) {
	const thread = useStore((s) => s.held[threadId]?.thread);
	const version = useStore((s) => s.diffVersion[threadId] ?? 0);
	const [selector, setSelector] = useState<Selector>({ scope: "uncommitted" });
	const [read, setRead] = useState<Read | undefined>();
	const [error, setError] = useState<RequestError | Error | undefined>();
	const [loading, setLoading] = useState(false);
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
	const [selectedFile, setSelectedFile] = useState<string>();
	const [commits, setCommits] = useState<ResultOf<"git/log">["commits"]>([]);
	const [branches, setBranches] = useState<ResultOf<"git/branches">>();
	const scroller = useRef<HTMLDivElement>(null);
	const filterRef = useRef<HTMLInputElement>(null);

	const load = useCallback(async () => {
		if (selector.scope === "committed" && !selector.commit) return;
		setLoading(true);
		try {
			const result = await client.request("thread/diff/read", {
				threadId,
				scope: selector.scope,
				...(selector.against ? { against: selector.against } : {}),
				...(selector.commit ? { commit: selector.commit } : {}),
				context: opts.fullFiles ? 1_000_000 : 3,
				...(opts.ignoreWhitespace ? { ignoreWhitespace: true } : {}),
			});
			setRead(result);
			setError(undefined);
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)));
		} finally {
			setLoading(false);
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
	const tree = useMemo(() => buildTree(shown), [shown]);
	const label = SCOPES.find((s) => s.scope === selector.scope)!.label;

	const act = async (action: "stage" | "unstage" | "revert", file: DiffFile) => {
		try {
			if (action === "revert") {
				if (!window.confirm(`${selector.scope === "lastTurn" ? "Undo" : "Revert"} the changes to ${file.path}?`))
					return;
				await client.request("thread/diff/revert", {
					threadId,
					scope: selector.scope,
					...(selector.against ? { against: selector.against } : {}),
					path: file.path,
				});
			} else await client.request(action === "stage" ? "git/stage" : "git/unstage", { threadId, path: file.path });
			await load();
		} catch (e) {
			toast(errorText(e));
		}
	};

	const copyApply = () => {
		const patch = files.map(patchOf).join("");
		void client.host("host/clipboard/writeText", {
			text: `git apply <<'KNIGHTCODE_PATCH'\n${patch}KNIGHTCODE_PATCH\n`,
		});
	};

	const scrollTo = (path: string) => {
		setSelectedFile(path);
		const index = shown.findIndex((f) => f.path === path);
		scroller.current?.querySelectorAll<HTMLElement>("[data-file-section]")[index]?.scrollIntoView({ block: "start" });
	};

	const notGit = error instanceof RequestError && error.code === "notGitRepo";
	return (
		<div className="kc-changes flex h-full min-h-0 min-w-0 flex-col" aria-label="Changes" aria-busy={loading}>
			<header className="relative z-20 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 p-2 text-[13px]">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<Capsule label="Review source">
						<Popover
							side="bottom"
							trigger={(open) => (
								<button
									type="button"
									className={`flex h-7 min-w-0 items-center gap-1 rounded-full ps-3 pe-1.5 text-[13px] leading-5 text-ink ${open ? "bg-ghost-hover" : "hover:bg-ghost-hover"}`}
								>
									<span className="min-w-0 truncate">{label}</span>
									<ChevronDown size={14} className="shrink-0" />
								</button>
							)}
						>
							{(close) => (
								<div className="w-[192px]">
									{SCOPES.map(({ scope, label: name }, i) => (
										<div key={scope}>
											{i === 1 || i === 4 ? <div className="mx-2 my-1 border-t border-hairline" /> : null}
											{scope === "committed" ? (
												<CommitsItem
													threadId={threadId}
													commits={commits}
													onOpen={() =>
														void client
															.request("git/log", { threadId })
															.then((r) => setCommits(r.commits))
															.catch((e: unknown) => toast(errorText(e)))
													}
													onPick={(commit) => {
														close();
														setSelector({ scope: "committed", commit });
													}}
												/>
											) : (
												<MenuItem
													checked={selector.scope === scope}
													onClick={() => {
														close();
														setSelector({ scope });
													}}
												>
													{name}
												</MenuItem>
											)}
										</div>
									))}
								</div>
							)}
						</Popover>
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
							<Popover
								side="bottom"
								trigger={() => (
									<button
										type="button"
										className="flex h-7 items-center gap-1 rounded-full ps-3 pe-1.5 text-[13px] text-ink hover:bg-ghost-hover"
									>
										<span className="text-desc">HEAD →</span>
										<span>
											{selector.against ?? branches?.defaultBranch ?? read?.against?.slice(0, 12) ?? "Select branch"}
										</span>
										<ChevronDown size={14} />
									</button>
								)}
							>
								{(close) => (
									<div className="max-h-80 w-56 overflow-y-auto">
										{(branches?.branches ?? []).map((b) => (
											<MenuItem
												key={b}
												checked={(selector.against ?? branches?.defaultBranch) === b}
												onClick={() => {
													close();
													setSelector({ scope: "branch", against: b });
												}}
											>
												{b}
											</MenuItem>
										))}
									</div>
								)}
							</Popover>
						</Capsule>
					) : null}
				</div>
				<div className="ms-auto flex shrink-0 items-center gap-1.5">
					<Capsule label="Changes controls">
						<Popover
							side="bottom"
							align="right"
							trigger={() => (
								<ControlButton label="Changes options">
									<MoreHorizontal size={16} />
								</ControlButton>
							)}
						>
							{(close) => (
								<div className="w-[212px]">
									<MenuItem
										checked={opts.fullFiles}
										onClick={() => setOpts((o) => ({ ...o, fullFiles: !o.fullFiles }))}
									>
										Load full files
									</MenuItem>
									<MenuItem
										checked={opts.wordDiffs}
										onClick={() => setOpts((o) => ({ ...o, wordDiffs: !o.wordDiffs }))}
									>
										Word diffs
									</MenuItem>
									<MenuItem
										checked={opts.ignoreWhitespace}
										onClick={() => setOpts((o) => ({ ...o, ignoreWhitespace: !o.ignoreWhitespace }))}
									>
										Hide white space
									</MenuItem>
									<MenuItem
										onClick={() => {
											close();
											copyApply();
										}}
									>
										Copy git apply command
									</MenuItem>
								</div>
							)}
						</Popover>
						<ControlButton
							label="Jump to file"
							onClick={() => {
								setOpts((o) => ({ ...o, tree: true }));
								requestAnimationFrame(() => filterRef.current?.focus());
							}}
						>
							<FileSearch size={16} />
						</ControlButton>
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
						<ControlButton
							label="Collapse all diffs"
							onClick={() =>
								setCollapsed((set) => (set.size === files.length ? new Set() : new Set(files.map((f) => f.path))))
							}
						>
							<ChevronsDownUp size={16} />
						</ControlButton>
						<ControlButton
							label={opts.split ? "Switch to unified diff" : "Switch to split diff"}
							onClick={() => setOpts((o) => ({ ...o, split: !o.split }))}
						>
							{opts.split ? <Rows2 size={16} /> : <Columns2 size={16} />}
						</ControlButton>
						<ControlButton
							label="Hide files"
							pressed={opts.tree}
							onClick={() => setOpts((o) => ({ ...o, tree: !o.tree }))}
						>
							<PanelRight size={16} />
						</ControlButton>
					</Capsule>
				</div>
			</header>
			{read?.untrackedSkipped ? (
				<div className="mx-2 mb-2 flex items-center gap-3 rounded-xl bg-row px-3 py-2 text-[13px] text-desc">
					<span className="flex-1">
						Showing tracked changes only ({read.untrackedSkipped} untracked files skipped). Add build output to
						.gitignore to see the rest.
					</span>
					<button type="button" onClick={() => void load()} className="text-ink hover:underline">
						Refresh
					</button>
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 border-t border-hairline">
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
									className="mt-3 h-7 rounded-lg bg-row px-2.5 text-[13px] text-ink hover:bg-ghost-hover"
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
								<div className="px-4 pt-2 pb-1 text-[12px] text-desc">Files that changed while this turn ran</div>
							) : null}
							{shown.map((file) => (
								<div key={file.path} data-file-section="">
									<FileSection
										threadId={threadId}
										cwd={thread?.cwd ?? ""}
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
									/>
								</div>
							))}
							{read?.filesOmitted ? (
								<div className="px-4 py-3 text-[13px] text-desc">{read.filesOmitted} more files are not shown.</div>
							) : null}
						</>
					)}
				</div>
				{opts.tree && !notGit ? (
					<div className="flex h-full w-[250px] shrink-0 flex-col border-l border-hairline px-1">
						<div className="flex shrink-0 items-center gap-1 px-1 pt-1 pb-px">
							<label className="flex h-7 w-full items-center gap-1.5 rounded-[12.5px] border border-hairline bg-soft ps-2 text-[14px] leading-[18px]">
								<Search size={14} className="shrink-0 text-desc" />
								<input
									ref={filterRef}
									value={filter}
									onChange={(e) => setFilter(e.target.value)}
									placeholder="Filter files…"
									className="w-full bg-transparent pe-1.5 text-ink outline-none placeholder:text-desc focus-visible:outline-none"
								/>
							</label>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-1 pt-1">
							{shown.length === 0 && filter ? (
								<div className="px-2 py-1.5 text-[13px] text-ink">No matching files</div>
							) : (
								<Tree nodes={tree} depth={0} selected={selectedFile} onSelect={scrollTo} />
							)}
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}

/** "Committed ›": the commits since the base, from git/log; picking one shows exactly that commit. */
function CommitsItem({
	commits,
	onOpen,
	onPick,
}: {
	threadId: string;
	commits: ResultOf<"git/log">["commits"];
	onOpen: () => void;
	onPick: (sha: string) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="relative" onMouseLeave={() => setOpen(false)}>
			<button
				type="button"
				onMouseEnter={() => {
					setOpen(true);
					onOpen();
				}}
				onClick={() => {
					setOpen(true);
					onOpen();
				}}
				className="kc-row text-ink"
			>
				<span className="flex-1">Committed</span>
				<ChevronRight size={14} className="text-desc" />
			</button>
			{open ? (
				<div className="kc-menu absolute top-0 left-full z-40 ml-1 max-h-80 w-72 overflow-y-auto">
					{commits.length === 0 ? (
						<div className="px-2 py-1.5 text-[13px] text-desc">No commits since the base</div>
					) : (
						commits.map((c) => (
							<MenuItem key={c.sha} onClick={() => onPick(c.sha)} description={`${c.sha.slice(0, 7)} · ${c.author}`}>
								{c.subject}
							</MenuItem>
						))
					)}
				</div>
			) : null}
		</div>
	);
}
