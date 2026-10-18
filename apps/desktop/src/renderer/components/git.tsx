/**
 * Worktrees and git in the desktop (desktop-shell.md section 9.6), after Codex's: the composer's "Configure local
 * environment" popover, a thread's summary with its Actions and Git actions menus, and the commit, branch, pull
 * request and handoff dialogs.
 */

import type { Environment, ResultOf, Thread, WorkspaceRequest } from "@knightcode/app-server-protocol";
import {
	ArrowLeftRight,
	ArrowUpRight,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	CloudUpload,
	FileDiff,
	GitBranch,
	GitBranchPlus,
	GitCommitHorizontal,
	GitPullRequest,
	GitPullRequestDraft,
	ListTodo,
	MoreHorizontal,
	Plus,
	Search,
	Settings,
	SquareTerminal,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { client } from "../client.ts";
import { basename } from "../format.ts";
import { matches } from "../keys.ts";
import { errorText, handoff, navigate, RequestError, refreshDiff, setPanel, toast, useStore } from "../store.ts";
import { Totals } from "./changes.tsx";
import { MenuCaption, MenuItem, Popover } from "./popover.tsx";

/** A branch name from a chat title, as the server slugs one for a handoff (`kc/<slug>`). */
export function slug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40)
			.replace(/-+$/, "") || "handoff"
	);
}

/** Codex's switch: 28 by 16, white track when on, a dark 12px knob. */
function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-label={label}
			aria-checked={value}
			onClick={() => onChange(!value)}
			className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${value ? "bg-strong" : "bg-track"}`}
		>
			<span
				className={`absolute top-0.5 size-3 rounded-full bg-surface shadow-[0_1px_2px_-1px_rgb(0_0_0/0.08)] transition-all ${value ? "left-[14px]" : "left-0.5"}`}
			/>
		</button>
	);
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
	return (
		<button type="button" onClick={onBack} className="kc-row text-desc">
			<ChevronLeft size={14} /> <span className="text-[13px]">{title}</span>
		</button>
	);
}

function SearchRow({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
}) {
	return (
		<label className="mx-1 mb-2 flex items-center gap-2 border-b border-hairline px-1 py-2.5 text-[13px]">
			<Search size={14} className="shrink-0 text-desc" />
			<input
				autoFocus
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-desc focus-visible:outline-none"
			/>
		</label>
	);
}

/**
 * "Configure local environment" (the composer's gear for a new chat): New worktree, the branch to start from
 * ("<branch> with local code changes" carries the checkout's edits), and the environment whose setup runs.
 */
export function WorkspacePopover({
	cwd,
	value,
	onChange,
}: {
	cwd: string | undefined;
	value: WorkspaceRequest;
	onChange: (value: WorkspaceRequest) => void;
}) {
	return (
		<Popover
			align="right"
			trigger={(open) => (
				<button
					type="button"
					title="Configure local environment"
					aria-label="Configure local environment"
					className={`flex size-7 items-center justify-center rounded-md text-desc hover:bg-ghost-hover hover:text-ink ${open ? "bg-ghost-hover text-ink" : ""}`}
				>
					<Settings size={16} />
				</button>
			)}
		>
			{(close) => <WorkspaceMenu cwd={cwd} value={value} onChange={onChange} close={close} />}
		</Popover>
	);
}

function WorkspaceMenu({
	cwd,
	value,
	onChange,
	close,
}: {
	cwd: string | undefined;
	value: WorkspaceRequest;
	onChange: (value: WorkspaceRequest) => void;
	close: () => void;
}) {
	const [view, setView] = useState<"main" | "branch" | "environment">("main");
	const [branches, setBranches] = useState<ResultOf<"git/branches">>();
	const [environments, setEnvironments] = useState<Environment[]>([]);
	const [query, setQuery] = useState("");
	useEffect(() => {
		if (!cwd) return;
		void client
			.request("git/branches", { cwd })
			.then(setBranches)
			.catch(() => setBranches(undefined));
		void client
			.request("environment/list", { cwd })
			.then((r) => setEnvironments(r.environments))
			.catch(() => setEnvironments([]));
	}, [cwd]);
	const worktree = value.mode === "worktree" ? value : undefined;
	const current = branches?.current ?? "HEAD";
	const branchLabel = worktree?.baseRef ?? current;
	const row = (icon: ReactNode, name: string, detail: string, onClick: () => void) => (
		<button
			type="button"
			onClick={onClick}
			className="flex h-7 w-full items-center gap-1 rounded-[12.5px] px-2 text-[13px] hover:bg-row"
		>
			<span className="flex size-4 shrink-0 items-center justify-center text-ink">{icon}</span>
			<span className="flex min-w-0 flex-1 items-center justify-between gap-4 ps-1">
				<span className="text-ink">{name}</span>
				<span className="truncate text-head">{detail}</span>
			</span>
			<ChevronRight size={14} className="shrink-0 text-desc" />
		</button>
	);
	if (view === "branch")
		return (
			<div className="w-[252px]">
				<BackHeader title="Branch" onBack={() => setView("main")} />
				<SearchRow value={query} onChange={setQuery} placeholder="Search branches…" />
				<MenuCaption>Local file state</MenuCaption>
				<MenuItem
					icon={<GitBranch size={14} />}
					description="with local code changes"
					checked={Boolean(worktree?.carryLocalChanges)}
					onClick={() => {
						onChange({
							mode: "worktree",
							carryLocalChanges: true,
							...(worktree?.environment ? { environment: worktree.environment } : {}),
						});
						setView("main");
					}}
				>
					{current}
				</MenuItem>
				<MenuCaption>Local branches</MenuCaption>
				<div className="max-h-48 overflow-y-auto">
					{(branches?.branches ?? [])
						.filter((b) => b.toLowerCase().includes(query.toLowerCase()))
						.map((b) => (
							<MenuItem
								key={b}
								icon={<GitBranch size={14} />}
								checked={!worktree?.carryLocalChanges && (worktree?.baseRef ?? current) === b}
								onClick={() => {
									onChange({
										mode: "worktree",
										...(b === current ? {} : { baseRef: b }),
										...(worktree?.environment ? { environment: worktree.environment } : {}),
									});
									setView("main");
								}}
							>
								{b}
							</MenuItem>
						))}
				</div>
			</div>
		);
	if (view === "environment")
		return (
			<div className="w-[252px]">
				<BackHeader title="Environment" onBack={() => setView("main")} />
				<SearchRow value={query} onChange={setQuery} placeholder="Search environments…" />
				<MenuItem
					checked={!worktree?.environment}
					onClick={() => {
						if (worktree) {
							const { environment: _, ...rest } = worktree;
							onChange(rest);
						}
						setView("main");
					}}
				>
					Work without environment
				</MenuItem>
				{environments
					.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
					.map((e) => (
						<MenuItem
							key={e.name}
							checked={worktree?.environment === e.name}
							onClick={() => {
								onChange({ ...(worktree ?? { mode: "worktree" }), environment: e.name });
								setView("main");
							}}
						>
							{e.name}
						</MenuItem>
					))}
				<MenuItem
					icon={<ArrowUpRight size={14} />}
					onClick={() => {
						close();
						navigate({ kind: "settings", page: "worktrees" });
					}}
				>
					Set up project
				</MenuItem>
			</div>
		);
	return (
		<div className="w-[252px]">
			<div className="px-2 py-[5px] text-[13px] leading-4 text-desc">Configure local environment</div>
			<div className="flex h-7 items-center gap-1 px-2 text-[13px]">
				<GitBranchPlus size={16} className="shrink-0 text-ink" />
				<label className="min-w-0 flex-1 ps-1 text-ink">New worktree</label>
				<Switch
					label="New worktree"
					value={value.mode === "worktree"}
					onChange={(on) => onChange(on ? { mode: "worktree" } : { mode: "local" })}
				/>
			</div>
			{value.mode === "worktree" ? (
				<>
					{row(<GitBranch size={14} />, "Branch", branchLabel, () => setView("branch"))}
					{row(<Settings size={14} />, "Environment", worktree?.environment ?? "No environment", () =>
						setView("environment"),
					)}
				</>
			) : null}
		</div>
	);
}

/** A floating card over the window (Codex's commit and pull request cards); a click outside or Escape closes it. */
export function Sheet({ onClose, children, dialog }: { onClose: () => void; children: ReactNode; dialog?: boolean }) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (matches(event, "desktop.picker.dismiss")) {
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);
	return (
		<div className="fixed inset-0 z-50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div
				role="dialog"
				className={
					dialog
						? "kc-dialog absolute top-1/2 left-1/2 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-[25px] p-5 text-ink"
						: "kc-card absolute top-1/2 left-1/2 flex w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-[20px] p-1 text-ink"
				}
			>
				{children}
			</div>
		</div>
	);
}

function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="rounded-[10px] bg-[rgb(255_255_255/0.1)] px-1.5 font-ui text-[12px] leading-4 text-ink">
			{children}
		</kbd>
	);
}

function ActionRow({
	icon,
	label,
	hint,
	disabled,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	hint?: ReactNode;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="flex h-[31px] w-full items-center gap-2 rounded-[12.5px] px-2 text-[14px] leading-[21px] text-ink hover:bg-row disabled:text-desc disabled:hover:bg-transparent"
		>
			<span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
			<span className="flex-1 text-start">{label}</span>
			{hint}
		</button>
	);
}

function Checkbox({
	value,
	onChange,
	label,
	totals,
}: {
	value: boolean;
	onChange: (v: boolean) => void;
	label: string;
	totals?: ReactNode;
}) {
	return (
		<label className="flex cursor-default items-center gap-2.5 px-3 py-2 text-[14px] leading-[21px]">
			<button
				type="button"
				role="checkbox"
				aria-checked={value}
				onClick={() => onChange(!value)}
				className="flex size-3.5 items-center justify-center rounded-[5px] border border-[rgb(255_255_255/0.157)] bg-[rgb(45_45_45/0.96)]"
			>
				{value ? <Check size={11} strokeWidth={2.5} /> : null}
			</button>
			<span className="flex-1">{label}</span>
			{totals}
		</label>
	);
}

/** Totals of the uncommitted changes, for the commit and pull request cards. */
function useUncommitted(threadId: string) {
	const [totals, setTotals] = useState<{ additions: number; deletions: number }>();
	useEffect(() => {
		void client
			.request("thread/diff/read", { threadId, scope: "uncommitted", context: 0 })
			.then((r) =>
				setTotals({
					additions: r.files.reduce((n, f) => n + f.additions, 0),
					deletions: r.files.reduce((n, f) => n + f.deletions, 0),
				}),
			)
			.catch(() => setTotals(undefined));
	}, [threadId]);
	return totals;
}

function useStatus(threadId: string) {
	const [status, setStatus] = useState<ResultOf<"git/status">>();
	useEffect(() => {
		void client
			.request("git/status", { threadId })
			.then(setStatus)
			.catch(() => setStatus(undefined));
	}, [threadId]);
	return status;
}

/** Codex's "Commit or push" card: a new branch for a detached worktree, the message, then Commit, Commit and push, Push. */
export function CommitSheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const status = useStatus(thread.id);
	const totals = useUncommitted(thread.id);
	const prefix = "kc/";
	const [newBranch, setNewBranch] = useState(true);
	const [branch, setBranch] = useState(`${prefix}${slug(thread.name)}`);
	const [message, setMessage] = useState("");
	const [includeUnstaged, setIncludeUnstaged] = useState(true);
	const [busy, setBusy] = useState(false);
	const detached = status !== undefined && !status.branch;
	const run = async (push: boolean, commit: boolean) => {
		setBusy(true);
		try {
			if (detached && newBranch) await client.request("git/branch/create", { threadId: thread.id, name: branch });
			if (commit) {
				const result = await client.request("git/commit", {
					threadId: thread.id,
					...(message.trim() ? { message } : {}),
					includeUnstaged,
				});
				toast(`Committed ${result.commit.slice(0, 7)}: ${result.message.split("\n")[0]}`);
			}
			if (push) {
				const pushed = await client.request("git/push", { threadId: thread.id });
				toast(`Pushed ${pushed.branch} to ${pushed.remote}`);
			}
			onClose();
		} catch (e) {
			toast(errorText(e));
		} finally {
			setBusy(false);
		}
	};
	const mod = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";
	return (
		<Sheet onClose={onClose}>
			<h2 className="sr-only">Commit or push</h2>
			{detached ? (
				<Popover
					side="bottom"
					trigger={() => (
						<button
							type="button"
							className="flex h-9 w-fit items-center gap-1 rounded-full py-2 ps-2 pe-5 text-[14px] leading-[18px] hover:bg-row"
						>
							<GitBranch size={15} /> <span className="ps-1">{newBranch ? "New branch" : "Detached HEAD"}</span>
							<ChevronDown size={14} />
						</button>
					)}
				>
					{(close) => (
						<div className="w-56">
							<MenuItem checked={newBranch} onClick={() => (setNewBranch(true), close())}>
								New branch
							</MenuItem>
							<MenuItem checked={!newBranch} onClick={() => (setNewBranch(false), close())}>
								Detached HEAD
							</MenuItem>
						</div>
					)}
				</Popover>
			) : (
				<div className="flex h-9 items-center gap-1 ps-2 text-[14px] leading-[18px]">
					<GitBranch size={15} /> <span className="ps-1">{status?.branch ?? "…"}</span>
				</div>
			)}
			{detached && newBranch ? (
				<input
					value={branch}
					onChange={(e) => setBranch(e.target.value)}
					aria-label="Branch name"
					className="mx-3 mt-1 bg-transparent text-[14px] leading-[21px] text-ink outline-none focus-visible:outline-none"
				/>
			) : null}
			<textarea
				autoFocus
				value={message}
				onChange={(e) => setMessage(e.target.value)}
				onKeyDown={(e) => {
					if (matches(e, "desktop.composer.steer")) void run(false, true);
				}}
				placeholder="Commit message (leave blank to generate)…"
				className="h-20 resize-none bg-transparent px-3 py-2 text-[14px] leading-[21px] text-ink outline-none placeholder:text-desc focus-visible:outline-none"
			/>
			<Checkbox
				label="Include unstaged changes"
				value={includeUnstaged}
				onChange={setIncludeUnstaged}
				totals={totals ? <Totals {...totals} className="text-[14px]" /> : null}
			/>
			<div className="mx-1 border-t border-hairline" />
			<ActionRow
				icon={<GitCommitHorizontal size={15} />}
				label={busy ? "Committing…" : "Commit"}
				disabled={busy}
				hint={<Kbd>{mod}+⏎</Kbd>}
				onClick={() => void run(false, true)}
			/>
			<ActionRow
				icon={<CloudUpload size={15} />}
				label="Commit and push"
				disabled={busy}
				onClick={() => void run(true, true)}
			/>
			<ActionRow
				icon={<CloudUpload size={15} />}
				label="Push"
				disabled={busy || !status?.branch || (status.ahead === 0 && Boolean(status.upstream))}
				onClick={() => void run(true, false)}
			/>
		</Sheet>
	);
}

/** "Work here": Codex's dialog that turns a detached worktree into a branch. */
export function CreateBranchDialog({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const [name, setName] = useState(`kc/${slug(thread.name)}`);
	const [error, setError] = useState<string>();
	const create = async () => {
		try {
			const { branch } = await client.request("git/branch/create", { threadId: thread.id, name });
			toast(`Created ${branch}`);
			onClose();
		} catch (e) {
			setError(errorText(e));
		}
	};
	return (
		<Sheet onClose={onClose} dialog>
			<DialogClose onClose={onClose} />
			<IconTile>
				<GitBranch size={18} />
			</IconTile>
			<h2 className="mt-5 text-[20px] leading-7 font-semibold">Work here</h2>
			<p className="mt-1 text-[14px] leading-5 text-desc">
				Create a branch to commit changes, push, and create a PR from this worktree.
			</p>
			<div className="mt-4 flex items-center justify-between text-[14px]">
				<span className="font-semibold">Branch name</span>
				<button
					type="button"
					onClick={() => navigate({ kind: "settings", page: "worktrees" })}
					className="text-desc hover:text-ink"
				>
					Set prefix
				</button>
			</div>
			<input
				autoFocus
				value={name}
				onChange={(e) => setName(e.target.value)}
				onKeyDown={(e) => matches(e, "desktop.item.activate") && void create()}
				className="mt-2 h-10 w-full rounded-[12.5px] border border-hairline bg-transparent px-3 text-[14px] text-ink outline-none focus:border-[rgb(255_255_255/0.2)] focus-visible:outline-none"
			/>
			<button
				type="button"
				onClick={() => void create()}
				className="mt-4 h-[34px] w-full rounded-full border border-hairline bg-white text-[14px] font-medium text-[#2d2d2d] hover:opacity-90"
			>
				Create
			</button>
			{error ? <p className="mt-3 text-center text-[14px] text-danger-text">{error}</p> : null}
		</Sheet>
	);
}

function IconTile({ children }: { children: ReactNode }) {
	return (
		<span className="flex size-9 items-center justify-center rounded-[15px] bg-[#141414] text-ink">{children}</span>
	);
}

function DialogClose({ onClose }: { onClose: () => void }) {
	return (
		<button
			type="button"
			aria-label="Close dialog"
			onClick={onClose}
			className="absolute top-5 right-5 rounded p-1 text-[rgb(255_255_255/0.8)] hover:text-ink"
		>
			<X size={16} />
		</button>
	);
}

/** Codex's branch switcher: search, the local branches, and "Create and checkout new branch…". */
export function SwitchBranchSheet({
	thread,
	onClose,
	onCreate,
}: {
	thread: Thread;
	onClose: () => void;
	onCreate: () => void;
}) {
	const [branches, setBranches] = useState<ResultOf<"git/branches">>();
	const [query, setQuery] = useState("");
	useEffect(() => {
		void client
			.request("git/branches", { threadId: thread.id })
			.then(setBranches)
			.catch((e: unknown) => toast(errorText(e)));
	}, [thread.id]);
	const project = basename(thread.projectCwd);
	return (
		<Sheet onClose={onClose}>
			<div className="flex min-h-[300px] w-full flex-col">
				<SearchRow value={query} onChange={setQuery} placeholder={`Search ${project} branches`} />
				<MenuCaption>Branches</MenuCaption>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{(branches?.branches ?? [])
						.filter((b) => b.toLowerCase().includes(query.toLowerCase()))
						.map((b) => (
							<MenuItem
								key={b}
								icon={<GitBranch size={14} />}
								checked={branches?.current === b}
								onClick={() =>
									void client
										.request("git/branch/switch", { threadId: thread.id, name: b })
										.then(() => {
											toast(`Switched to ${b}`);
											onClose();
										})
										.catch((e: unknown) => toast(errorText(e)))
								}
							>
								{b}
							</MenuItem>
						))}
				</div>
				<div className="mx-1 my-1 border-t border-hairline" />
				<MenuItem
					icon={<Plus size={14} />}
					onClick={() => {
						onClose();
						onCreate();
					}}
				>
					Create and checkout new branch…
				</MenuItem>
			</div>
		</Sheet>
	);
}

/** Codex's pull request card: branch → base, title, description, then draft or ready. */
export function PullRequestSheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const status = useStatus(thread.id);
	const totals = useUncommitted(thread.id);
	const [base, setBase] = useState<string>();
	const [branch, setBranch] = useState(`kc/${slug(thread.name)}`);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [commitFirst, setCommitFirst] = useState(true);
	const [url, setUrl] = useState<string>();
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		void client
			.request("git/branches", { threadId: thread.id })
			.then((r) => setBase(r.defaultBranch))
			.catch(() => {});
	}, [thread.id]);
	const detached = status !== undefined && !status.branch;
	const create = async (draft: boolean) => {
		setBusy(true);
		try {
			if (detached) await client.request("git/branch/create", { threadId: thread.id, name: branch });
			if (commitFirst && totals && totals.additions + totals.deletions > 0)
				await client.request("git/commit", { threadId: thread.id, includeUnstaged: true });
			await client.request("git/push", { threadId: thread.id });
			const result = await client.request("git/pr/create", {
				threadId: thread.id,
				...(title.trim() ? { title } : {}),
				...(body.trim() ? { body } : {}),
				...(draft ? { draft } : {}),
			});
			setUrl(result.url);
			toast(`Created ${result.url}`);
		} catch (error) {
			toast(
				error instanceof RequestError && error.code === "toolMissing"
					? "Install the GitHub CLI (gh) and sign in to create pull requests."
					: errorText(error),
			);
		} finally {
			setBusy(false);
		}
	};
	const mod = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";
	return (
		<Sheet onClose={onClose}>
			<div className="px-3 pt-2 text-[14px] leading-6 text-desc">
				{detached ? "New branch" : (status?.branch ?? "…")} → {base ?? "…"}
			</div>
			{detached ? (
				<input
					value={branch}
					onChange={(e) => setBranch(e.target.value)}
					aria-label="Branch name"
					className="mx-3 mt-2 bg-transparent text-[14px] leading-[21px] text-ink outline-none focus-visible:outline-none"
				/>
			) : null}
			<input
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="Title"
				className="mx-3 mt-3 bg-transparent text-[14px] leading-[21px] font-medium text-ink outline-none placeholder:text-desc focus-visible:outline-none"
			/>
			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder="Description (leave empty to generate)"
				className="h-20 resize-none bg-transparent px-3 py-2 text-[14px] leading-[21px] text-ink outline-none placeholder:text-desc focus-visible:outline-none"
			/>
			<Checkbox
				label="Commit and push local changes"
				value={commitFirst}
				onChange={setCommitFirst}
				totals={totals ? <Totals {...totals} className="text-[14px]" /> : null}
			/>
			<div className="mx-1 border-t border-hairline" />
			<ActionRow
				icon={<GitPullRequestDraft size={15} />}
				label="Create draft PR"
				disabled={busy}
				onClick={() => void create(true)}
			/>
			<ActionRow
				icon={<GitPullRequest size={15} />}
				label={busy ? "Creating…" : "Create PR"}
				disabled={busy}
				hint={<Kbd>{mod}+⏎</Kbd>}
				onClick={() => void create(false)}
			/>
			<ActionRow
				icon={<ArrowUpRight size={15} />}
				label="Open PR in browser"
				disabled={!url}
				onClick={() => url && void client.host("host/shell/openExternal", { url })}
			/>
		</Sheet>
	);
}

/**
 * Codex's "Bring changes back to local checkout" (and its reverse): the branch the main checkout gets, where the
 * changes go, and the server's refusal ("Stash or commit your local changes to hand off") verbatim.
 */
export function HandoffDialog({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const toLocal = thread.workspace.mode === "worktree";
	const [branch, setBranch] = useState(`kc/${slug(thread.name)}`);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const status = useStatus(thread.id);
	useEffect(() => {
		if (status?.branch) setBranch(status.branch);
	}, [status?.branch]);
	const main = toLocal ? thread.projectCwd : thread.cwd;
	const go = async () => {
		setBusy(true);
		setError(undefined);
		const result = await handoff(
			thread.id,
			toLocal ? "local" : "worktree",
			toLocal && !status?.branch ? branch : undefined,
		);
		setBusy(false);
		if (result instanceof RequestError) {
			const data = result.data as { recoveryInstructions?: string[]; paths?: string[] } | undefined;
			setError(data?.recoveryInstructions?.[0] ?? result.message);
			return;
		}
		if (result.branch) toast(`Checked out ${result.branch} in ${basename(main)}`);
		onClose();
	};
	return (
		<Sheet onClose={onClose} dialog>
			<DialogClose onClose={onClose} />
			<IconTile>
				<ArrowLeftRight size={18} />
			</IconTile>
			<h2 className="mt-5 text-[20px] leading-7 font-semibold">
				{toLocal ? "Bring changes back to local checkout" : "Move changes to a worktree"}
			</h2>
			<div className="mt-3 text-[14px] leading-8 text-desc">
				{toLocal ? (
					<>
						Check out branch{" "}
						{status?.branch ? (
							<span className="inline-block h-8 max-w-[220px] truncate rounded-[12.5px] bg-[rgb(255_255_255/0.05)] px-2 align-middle leading-8 text-ink">
								{status.branch}
							</span>
						) : (
							<input
								value={branch}
								onChange={(e) => setBranch(e.target.value)}
								aria-label="Branch"
								className="h-8 w-48 rounded-[12.5px] bg-[rgb(255_255_255/0.05)] px-2 text-ink outline-none focus-visible:outline-none"
							/>
						)}{" "}
						in a local workspace and detach it from worktree.
					</>
				) : (
					"Detach this worktree at your checkout's HEAD and move the chat and its uncommitted changes into it."
				)}
			</div>
			<div className="mt-5 text-[14px] leading-6 text-desc">
				{toLocal ? "Bringing changes back to local checkout" : "Moving changes from local checkout"}
			</div>
			<div className="mt-2 flex h-7 items-center gap-1.5 rounded-[12.5px] bg-[rgb(255_255_255/0.05)] px-2 text-[14px] leading-6 font-medium">
				{basename(thread.projectCwd)}
			</div>
			<p className="mt-2 text-[12px] leading-5 text-desc">{main.replaceAll("\\", "/")}</p>
			<button
				type="button"
				disabled={busy}
				onClick={() => void go()}
				className={`mt-5 h-11 w-full rounded-full border border-hairline bg-white px-4 text-[14px] leading-[18px] font-medium text-[#2d2d2d] hover:opacity-90 disabled:opacity-50 ${error ? "opacity-50" : ""}`}
			>
				{busy ? "Moving changes…" : toLocal ? "Bring changes back" : "Move to worktree"}
			</button>
			{error ? <p className="mt-3 text-center text-[14px] leading-6 text-danger-text">{error}</p> : null}
		</Sheet>
	);
}

type SheetKind = "commit" | "branch" | "switch" | "pr" | "handoff";

/** The summary's body: the project and its Actions, then Changes with Git actions on hover (menus open to the left). */
function SummaryBody({
	thread,
	closeSummary,
	open,
}: {
	thread: Thread;
	closeSummary: () => void;
	open: (kind: SheetKind) => void;
}) {
	const status = useStatus(thread.id);
	const inWorktree = thread.workspace.mode === "worktree";
	const nothingToPush = !status?.branch || (status.ahead === 0 && Boolean(status.upstream));
	const menuButton = "flex size-7 items-center justify-center rounded-full text-desc hover:bg-row hover:text-ink";
	return (
		<div className="w-[300px] p-2">
			<div className="flex h-9 items-center justify-between ps-3">
				<span className="truncate text-[13px] text-desc">{basename(thread.projectCwd)}</span>
				<Popover
					side="left"
					trigger={(menuOpen) => (
						<button
							type="button"
							aria-label="Actions"
							title="Actions"
							className={`${menuButton} ${menuOpen ? "bg-row text-ink" : ""}`}
						>
							<MoreHorizontal size={16} />
						</button>
					)}
				>
					{(closeMenu) => (
						<div className="w-[260px]">
							<MenuItem
								icon={<Plus size={14} />}
								onClick={() => {
									closeMenu();
									closeSummary();
									navigate({ kind: "settings", page: "worktrees" });
								}}
							>
								Set up local environment
							</MenuItem>
							<MenuItem
								icon={<SquareTerminal size={14} />}
								onClick={() => {
									closeMenu();
									void client.host("host/shell/showInFolder", { path: thread.cwd });
								}}
							>
								Show in folder
							</MenuItem>
							<div className="mx-2 my-1 border-t border-hairline" />
							<MenuItem
								onClick={() => {
									closeMenu();
									open("handoff");
								}}
							>
								{inWorktree ? "Move to main checkout" : "Move to worktree"}
							</MenuItem>
						</div>
					)}
				</Popover>
			</div>
			<div className="group flex h-[34px] items-center rounded-xl pe-1 hover:bg-row has-[[data-open]]:bg-row">
				<button
					type="button"
					onClick={() => {
						closeSummary();
						setPanel({ open: true });
					}}
					className="flex h-full min-w-0 flex-1 items-center gap-2.5 ps-3 text-[14px] text-ink"
				>
					<FileDiff size={16} /> Changes
				</button>
				<Popover
					side="left"
					trigger={(menuOpen) => (
						<button
							type="button"
							aria-label="Git actions"
							title="Git actions"
							data-open={menuOpen || undefined}
							className={`${menuButton} ${menuOpen ? "text-ink" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
						>
							<GitBranch size={15} />
						</button>
					)}
				>
					{(closeMenu) => {
						const item = (kind: SheetKind, label: string, disabled = false) => (
							<button
								type="button"
								disabled={disabled}
								onClick={() => {
									closeMenu();
									open(kind);
								}}
								className="kc-row text-ink disabled:text-desc disabled:hover:bg-transparent"
							>
								{label}
							</button>
						);
						return (
							<div className="w-[148px]">
								{item("commit", "Commit")}
								{item("commit", "Push", nothingToPush)}
								{item("branch", "Create branch")}
								{item("switch", "Switch branch")}
								{item("pr", "Create pull request")}
							</div>
						);
					}}
				</Popover>
			</div>
		</div>
	);
}

/** The thread's summary (Codex's "Toggle summary"): the project, its Actions and Git actions, and Changes. */
export function ThreadSummary({ thread }: { thread: Thread }) {
	const [sheet, setSheet] = useState<SheetKind>();
	// Commits, switches and handoffs change the checkout without a turn; reload an open Changes pane.
	const close = () => {
		setSheet(undefined);
		refreshDiff(thread.id);
	};
	return (
		<>
			<Popover
				side="bottom"
				align="right"
				trigger={(open) => (
					<button
						type="button"
						title="Toggle summary"
						aria-label="Toggle summary"
						className={`no-drag flex size-8 items-center justify-center rounded-lg ${open ? "bg-hover text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
					>
						<ListTodo size={16} />
					</button>
				)}
			>
				{(closeSummary) => (
					<SummaryBody
						thread={thread}
						closeSummary={closeSummary}
						open={(kind) => {
							closeSummary();
							setSheet(kind);
						}}
					/>
				)}
			</Popover>
			{sheet === "commit" ? <CommitSheet thread={thread} onClose={close} /> : null}
			{sheet === "branch" ? <CreateBranchDialog thread={thread} onClose={close} /> : null}
			{sheet === "switch" ? (
				<SwitchBranchSheet thread={thread} onClose={close} onCreate={() => setSheet("branch")} />
			) : null}
			{sheet === "pr" ? <PullRequestSheet thread={thread} onClose={close} /> : null}
			{sheet === "handoff" ? <HandoffDialog thread={thread} onClose={close} /> : null}
		</>
	);
}

/** The composer chip for drafted review comments ("1 comment"); hover removes them all. */
export function CommentsChip({ threadId }: { threadId: string }) {
	const count = useStore((s) => s.comments[threadId]?.length ?? 0);
	if (count === 0) return null;
	return (
		<button
			type="button"
			onClick={() => setPanel({ open: true })}
			className="inline-flex max-w-[320px] items-center gap-1 rounded-[10px] border border-hairline bg-panel px-2 py-1.5 text-[13px] leading-[18.5px] text-ink"
		>
			<FileDiff size={14} className="text-desc" />
			<span className="pe-1 font-medium">
				{count} comment{count === 1 ? "" : "s"}
			</span>
		</button>
	);
}
