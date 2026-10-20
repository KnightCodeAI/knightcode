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
} from "./icons.tsx";
import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { client } from "../client.ts";
import { basename } from "../format.ts";
import { matches } from "../keys.ts";
import { errorText, handoff, navigate, RequestError, refreshDiff, setPanel, toast, useStore } from "../store.ts";
import { Button, IconButton, Kbd } from "./button.tsx";
import { Totals } from "./changes.tsx";
import { Dialog } from "./dialog.tsx";
import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "./menu.tsx";
import { ListCaption, ListRow, ListSeparator, Popover } from "./popover.tsx";
import { Switch } from "./switch.tsx";

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

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
	return (
		<button type="button" onClick={onBack} className="kc-row text-tertiary">
			<ChevronLeft size={14} /> <span className="text-sm">{title}</span>
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
		<label className="mx-1 mb-2 flex items-center gap-2 border-b border-line px-1 py-2.5 text-sm">
			<Search size={14} className="shrink-0 text-tertiary" />
			<input
				autoFocus
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-tertiary focus-visible:outline-none"
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
			align="end"
			sideOffset={4}
			className="kc-menu-solid"
			trigger={(open) => (
				<IconButton label="Configure local environment" aria-expanded={open}>
					<Settings size={16} />
				</IconButton>
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
			className="flex h-7 w-full items-center gap-1 rounded-lg px-2 text-sm hover:bg-ghost-hover"
		>
			<span className="flex size-4 shrink-0 items-center justify-center text-ink">{icon}</span>
			<span className="flex min-w-0 flex-1 items-center justify-between gap-4 ps-1">
				<span className="text-ink">{name}</span>
				<span className="truncate text-secondary">{detail}</span>
			</span>
			<ChevronRight size={14} className="shrink-0 text-tertiary" />
		</button>
	);
	if (view === "branch")
		return (
			<div className="w-[252px]">
				<BackHeader title="Branch" onBack={() => setView("main")} />
				<SearchRow value={query} onChange={setQuery} placeholder="Search branches…" />
				<ListCaption>Local file state</ListCaption>
				<ListRow
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
				</ListRow>
				<ListCaption>Local branches</ListCaption>
				<div className="max-h-48 overflow-y-auto">
					{(branches?.branches ?? [])
						.filter((b) => b.toLowerCase().includes(query.toLowerCase()))
						.map((b) => (
							<ListRow
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
							</ListRow>
						))}
				</div>
			</div>
		);
	if (view === "environment")
		return (
			<div className="w-[252px]">
				<BackHeader title="Environment" onBack={() => setView("main")} />
				<SearchRow value={query} onChange={setQuery} placeholder="Search environments…" />
				<ListRow
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
				</ListRow>
				{environments
					.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
					.map((e) => (
						<ListRow
							key={e.name}
							checked={worktree?.environment === e.name}
							onClick={() => {
								onChange({ ...(worktree ?? { mode: "worktree" }), environment: e.name });
								setView("main");
							}}
						>
							{e.name}
						</ListRow>
					))}
				<ListRow
					icon={<ArrowUpRight size={14} />}
					onClick={() => {
						close();
						navigate({ kind: "settings", page: "worktrees" });
					}}
				>
					Set up project
				</ListRow>
			</div>
		);
	return (
		<div className="w-[252px]">
			<div className="px-2 py-[5px] text-sm leading-4 text-tertiary">Configure local environment</div>
			<div className="flex h-7 items-center gap-1 px-2 text-sm">
				<GitBranchPlus size={16} className="shrink-0 text-ink" />
				<label className="min-w-0 flex-1 ps-1 text-ink">New worktree</label>
				<Switch
					size="sm"
					label="New worktree"
					checked={value.mode === "worktree"}
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
			className="flex h-[31px] w-full items-center gap-2 rounded-lg px-2 text-base text-ink hover:bg-ghost-hover disabled:text-tertiary disabled:hover:bg-transparent"
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
		<label className="flex cursor-default items-center gap-2.5 px-3 py-2 text-base">
			<button
				type="button"
				role="checkbox"
				aria-checked={value}
				onClick={() => onChange(!value)}
				className="flex size-3.5 items-center justify-center rounded-xs border border-line-strong bg-field aria-checked:border-[var(--kc-switch-on)] aria-checked:bg-[var(--kc-switch-on)] aria-checked:text-white"
			>
				{value ? <Check size={11} strokeWidth={1.7} /> : null}
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
				toast(`Committed ${result.commit.slice(0, 7)}: ${result.message.split("\n")[0]}`, "success");
			}
			if (push) {
				const pushed = await client.request("git/push", { threadId: thread.id });
				toast(`Pushed ${pushed.branch} to ${pushed.remote}`, "success");
			}
			onClose();
		} catch (e) {
			toast(errorText(e), "error");
		} finally {
			setBusy(false);
		}
	};
	const mod = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";
	return (
		<Dialog variant="card" title="Commit or push" onClose={onClose}>
			{detached ? (
				<Menu>
					<MenuTrigger>
						<button
							type="button"
							className="flex h-9 w-fit items-center gap-1 rounded-full py-2 ps-2 pe-5 text-base leading-[18px] hover:bg-ghost-hover data-[state=open]:bg-ghost-hover"
						>
							<GitBranch size={15} /> <span className="ps-1">{newBranch ? "New branch" : "Detached HEAD"}</span>
							<ChevronDown size={14} />
						</button>
					</MenuTrigger>
					<MenuContent>
						<MenuRadioGroup value={newBranch ? "new" : "detached"} onValueChange={(v) => setNewBranch(v === "new")}>
							<MenuRadioItem value="new">New branch</MenuRadioItem>
							<MenuRadioItem value="detached">Detached HEAD</MenuRadioItem>
						</MenuRadioGroup>
					</MenuContent>
				</Menu>
			) : (
				<div className="flex h-9 items-center gap-1 ps-2 text-base leading-[18px]">
					<GitBranch size={15} /> <span className="ps-1">{status?.branch ?? "…"}</span>
				</div>
			)}
			{detached && newBranch ? (
				<input
					value={branch}
					onChange={(e) => setBranch(e.target.value)}
					aria-label="Branch name"
					className="mx-3 mt-1 bg-transparent text-base text-ink outline-none focus-visible:outline-none"
				/>
			) : null}
			<textarea
				data-autofocus
				value={message}
				onChange={(e) => setMessage(e.target.value)}
				onKeyDown={(e) => {
					if (matches(e, "desktop.composer.steer")) void run(false, true);
				}}
				placeholder="Commit message (leave blank to generate)…"
				className="h-20 resize-none bg-transparent px-3 py-2 text-base text-ink outline-none placeholder:text-tertiary focus-visible:outline-none"
			/>
			<Checkbox
				label="Include unstaged changes"
				value={includeUnstaged}
				onChange={setIncludeUnstaged}
				totals={totals ? <Totals {...totals} className="text-base" /> : null}
			/>
			<div className="mx-1 border-t border-line" />
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
		</Dialog>
	);
}

/** "Work here": Codex's dialog that turns a detached worktree into a branch. */
export function CreateBranchDialog({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const [name, setName] = useState(`kc/${slug(thread.name)}`);
	const [error, setError] = useState<string>();
	const create = async () => {
		try {
			const { branch } = await client.request("git/branch/create", { threadId: thread.id, name });
			toast(`Created ${branch}`, "success");
			onClose();
		} catch (e) {
			setError(errorText(e));
		}
	};
	return (
		<Dialog
			title="Work here"
			description="Create a branch to commit changes, push, and create a PR from this worktree."
			icon={<GitBranch size={18} />}
			onClose={onClose}
		>
			<div className="mt-4 flex items-center justify-between text-base">
				<span className="font-semibold">Branch name</span>
				<button
					type="button"
					onClick={() => navigate({ kind: "settings", page: "worktrees" })}
					className="text-tertiary hover:text-ink"
				>
					Set prefix
				</button>
			</div>
			<input
				value={name}
				onChange={(e) => setName(e.target.value)}
				onKeyDown={(e) => matches(e, "desktop.item.activate") && void create()}
				aria-label="Branch name"
				className="kc-input mt-2 h-10 bg-transparent px-3 text-base"
			/>
			{/* Codex's 34px full-width confirm. */}
			<Button variant="solid" pill block onClick={() => void create()} className="mt-4 h-[34px] text-base font-medium">
				Create
			</Button>
			{error ? <p className="mt-3 text-center text-base text-danger-text">{error}</p> : null}
		</Dialog>
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
			.catch((e: unknown) => toast(errorText(e), "error"));
	}, [thread.id]);
	const project = basename(thread.projectCwd);
	return (
		<Dialog variant="card" title="Switch branch" onClose={onClose}>
			<div className="flex min-h-[300px] w-full flex-col">
				<SearchRow value={query} onChange={setQuery} placeholder={`Search ${project} branches`} />
				<ListCaption>Branches</ListCaption>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{(branches?.branches ?? [])
						.filter((b) => b.toLowerCase().includes(query.toLowerCase()))
						.map((b) => (
							<ListRow
								key={b}
								icon={<GitBranch size={14} />}
								checked={branches?.current === b}
								onClick={() =>
									void client
										.request("git/branch/switch", { threadId: thread.id, name: b })
										.then(() => {
											toast(`Switched to ${b}`, "success");
											onClose();
										})
										.catch((e: unknown) => toast(errorText(e), "error"))
								}
							>
								{b}
							</ListRow>
						))}
				</div>
				<ListSeparator />
				<ListRow
					icon={<Plus size={14} />}
					onClick={() => {
						onClose();
						onCreate();
					}}
				>
					Create and checkout new branch…
				</ListRow>
			</div>
		</Dialog>
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
			toast(`Created ${result.url}`, "success");
		} catch (error) {
			toast(
				error instanceof RequestError && error.code === "toolMissing"
					? "Install the GitHub CLI (gh) and sign in to create pull requests."
					: errorText(error),
				"error",
			);
		} finally {
			setBusy(false);
		}
	};
	const mod = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";
	return (
		<Dialog variant="card" title="Create pull request" onClose={onClose}>
			<div className="px-3 pt-2 text-base leading-6 text-tertiary">
				{detached ? "New branch" : (status?.branch ?? "…")} → {base ?? "…"}
			</div>
			{detached ? (
				<input
					value={branch}
					onChange={(e) => setBranch(e.target.value)}
					aria-label="Branch name"
					className="mx-3 mt-2 bg-transparent text-base text-ink outline-none focus-visible:outline-none"
				/>
			) : null}
			<input
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="Title"
				aria-label="Title"
				className="mx-3 mt-3 bg-transparent text-base font-medium text-ink outline-none placeholder:text-tertiary focus-visible:outline-none"
			/>
			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder="Description (leave empty to generate)"
				className="h-20 resize-none bg-transparent px-3 py-2 text-base text-ink outline-none placeholder:text-tertiary focus-visible:outline-none"
			/>
			<Checkbox
				label="Commit and push local changes"
				value={commitFirst}
				onChange={setCommitFirst}
				totals={totals ? <Totals {...totals} className="text-base" /> : null}
			/>
			<div className="mx-1 border-t border-line" />
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
		</Dialog>
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
		if (result.branch) toast(`Checked out ${result.branch} in ${basename(main)}`, "success");
		onClose();
	};
	return (
		<Dialog
			title={toLocal ? "Bring changes back to local checkout" : "Move changes to a worktree"}
			icon={<ArrowLeftRight size={18} />}
			onClose={onClose}
		>
			<div className="mt-3 text-base leading-8 text-tertiary">
				{toLocal ? (
					<>
						Check out branch{" "}
						{status?.branch ? (
							<span className="inline-block h-8 max-w-[220px] truncate rounded-lg bg-soft-alt px-2 align-middle leading-8 text-ink">
								{status.branch}
							</span>
						) : (
							<input
								value={branch}
								onChange={(e) => setBranch(e.target.value)}
								aria-label="Branch"
								className="h-8 w-48 rounded-lg bg-soft-alt px-2 text-ink outline-none focus-visible:outline-none"
							/>
						)}{" "}
						in a local workspace and detach it from worktree.
					</>
				) : (
					"Detach this worktree at your checkout's HEAD and move the chat and its uncommitted changes into it."
				)}
			</div>
			<div className="mt-5 text-base leading-6 text-tertiary">
				{toLocal ? "Bringing changes back to local checkout" : "Moving changes from local checkout"}
			</div>
			<div className="mt-2 flex h-7 items-center gap-1.5 rounded-lg bg-soft-alt px-2 text-base leading-6 font-medium">
				{basename(thread.projectCwd)}
			</div>
			<p className="mt-2 text-xs leading-5 text-tertiary">{main.replaceAll("\\", "/")}</p>
			{/* Codex's 44px full-width confirm, dimmed while its refusal shows. */}
			<Button
				variant="solid"
				pill
				block
				disabled={busy}
				onClick={() => void go()}
				className={`mt-5 h-11 text-base font-medium ${error ? "opacity-50" : ""}`}
			>
				{busy ? "Moving changes…" : toLocal ? "Bring changes back" : "Move to worktree"}
			</Button>
			{error ? <p className="mt-3 text-center text-base leading-6 text-danger-text">{error}</p> : null}
		</Dialog>
	);
}

type SheetKind = "commit" | "branch" | "switch" | "pr" | "handoff";

/** The summary's body: the project and its Actions, then Changes with Git actions on hover (both menus drop below). */
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
	return (
		<div className="w-[300px] p-2">
			<div className="flex h-9 items-center justify-between ps-3">
				<span className="truncate text-sm text-tertiary">{basename(thread.projectCwd)}</span>
				<Menu>
					<MenuTrigger>
						<IconButton label="Actions" round>
							<MoreHorizontal size={16} />
						</IconButton>
					</MenuTrigger>
					<MenuContent align="end" minWidth={260}>
						<MenuItem
							icon={<Plus />}
							onSelect={() => {
								closeSummary();
								navigate({ kind: "settings", page: "worktrees" });
							}}
						>
							Set up local environment
						</MenuItem>
						<MenuItem
							icon={<SquareTerminal />}
							onSelect={() => void client.host("host/shell/showInFolder", { path: thread.cwd })}
						>
							Show in folder
						</MenuItem>
						<MenuSeparator />
						<MenuItem onSelect={() => open("handoff")}>
							{inWorktree ? "Move to main checkout" : "Move to worktree"}
						</MenuItem>
					</MenuContent>
				</Menu>
			</div>
			<div className="group flex h-[34px] items-center rounded-xl pe-1 hover:bg-ghost-hover has-[[data-state=open]]:bg-ghost-hover">
				<button
					type="button"
					onClick={() => {
						closeSummary();
						setPanel({ open: true });
					}}
					className="flex h-full min-w-0 flex-1 items-center gap-2.5 ps-3 text-base text-ink"
				>
					<FileDiff size={16} /> Changes
				</button>
				{/* Codex's Git actions: plain rows, as wide as the longest. */}
				<Menu>
					<MenuTrigger>
						<IconButton
							label="Git actions"
							round
							className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
						>
							<GitBranch size={16} />
						</IconButton>
					</MenuTrigger>
					<MenuContent align="end" minWidth={0}>
						<MenuItem onSelect={() => open("commit")}>Commit</MenuItem>
						<MenuItem disabled={nothingToPush} onSelect={() => open("commit")}>
							Push
						</MenuItem>
						<MenuItem onSelect={() => open("branch")}>Create branch</MenuItem>
						<MenuItem onSelect={() => open("switch")}>Switch branch</MenuItem>
						<MenuItem onSelect={() => open("pr")}>Create pull request</MenuItem>
					</MenuContent>
				</Menu>
			</div>
		</div>
	);
}

/**
 * The thread's summary (Codex's "Toggle summary"): the project, its Actions and Git actions, and Changes. Like Codex's
 * it hangs from the header, not the button: 8px below it and 12px in from its end, so it slides out of that corner.
 */
export function ThreadSummary({ thread, anchor }: { thread: Thread; anchor: RefObject<HTMLElement | null> }) {
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
				align="end"
				anchor={anchor}
				// The panel's own 1px margin makes up the rest.
				sideOffset={7}
				alignOffset={11}
				className="kc-slide-in"
				trigger={(open) => (
					<IconButton label="Toggle summary" aria-expanded={open} className="no-drag">
						<ListTodo size={16} />
					</IconButton>
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
			className="inline-flex max-w-[320px] items-center gap-1 rounded-md border border-line bg-panel px-2 py-1.5 text-sm text-ink"
		>
			<FileDiff size={14} className="text-tertiary" />
			<span className="pe-1 font-medium">
				{count} comment{count === 1 ? "" : "s"}
			</span>
		</button>
	);
}
