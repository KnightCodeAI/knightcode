/** Git and workspace presentation uses only public controllers and shared controls. */
import {
	experimental_workspaceServices,
	experimental_controls,
	experimental_icons,
	experimental_shellServices,
	experimental_controllers,
	experimental_Button as Button,
	type experimental_WorkspaceThread as Thread,
	type experimental_WorkspaceRequest as WorkspaceRequest,
	type experimental_Checkout,
	type experimental_GitAction,
	type experimental_Operation,
} from "@knightcodeai/cli/desktop";
import { type ReactNode, useState } from "react";

/**
 * The branch a dialog suggests: the user's `worktrees.branchPrefix` (Settings › Worktrees, "kc/" by default) and the
 * title's slug, as the server names one for a handoff. `edited` once the user typed their own.
 */
function useSuggestedBranch(title: string) {
	const suggestion = experimental_workspaceServices().experimental_useBranchSuggestion(title);
	const [typed, setTyped] = useState<string>();
	return { branch: typed ?? suggestion, setBranch: setTyped, edited: typed !== undefined };
}

function checkout(thread: Thread): experimental_Checkout {
	return { threadId: thread.id, cwd: thread.cwd, projectCwd: thread.projectCwd };
}

function showOperationProblem(operation?: experimental_Operation) {
	const { experimental_notify: toast } = experimental_controllers();
	if (!operation?.problem) return;
	toast(
		operation.problem.code === "toolMissing" && operation.kind === "pullRequest"
			? "Install the GitHub CLI (gh) and sign in to create pull requests."
			: operation.problem.message,
		"error",
	);
}

function Recovery({ target, operation }: { target: experimental_Checkout; operation?: experimental_Operation }) {
	const git = experimental_workspaceServices().experimental_git(target);
	const [busy, setBusy] = useState(false);
	if (operation?.recovery === "retry") {
		const label =
			operation.kind === "pullRequest"
				? "Retry original PR request"
				: operation.kind === "commit"
					? "Retry commit"
					: operation.kind === "commitAndPush" && !operation.completed.includes("commit")
						? "Retry commit and push"
						: "Retry push";
		const retry = async () => {
			if (busy) return;
			setBusy(true);
			try {
				showOperationProblem(await git.experimental_recover(operation.id, "retry"));
			} finally {
				setBusy(false);
			}
		};
		return (
			<div role="alert" className="px-3 py-2 text-ink">
				The previous action is incomplete. Retry uses its saved options, not the fields above.
				<Button disabled={busy} onClick={() => void retry()}>
					{label}
				</Button>
				<Button disabled={busy} onClick={() => void git.experimental_recover(operation.id, "acknowledge")}>
					Dismiss previous action
				</Button>
			</div>
		);
	}
	if (operation?.recovery !== "reconcile") return null;
	return (
		<div role="alert" className="px-3 py-2 text-danger-text">
			The last action may have completed. Check the repository and remote before trying again.
			<Button onClick={() => void git.experimental_recover(operation.id, "acknowledge")}>I checked the outcome</Button>
		</div>
	);
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
	const { ChevronLeft } = experimental_icons();
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
	const { Search } = experimental_icons();
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
	const { experimental_IconButton: IconButton, experimental_Popover: Popover } = experimental_controls();
	const { Settings } = experimental_icons();
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
	const {
		experimental_Switch: Switch,
		experimental_ListCaption: ListCaption,
		experimental_ListRow: ListRow,
	} = experimental_controls();
	const { Settings, GitBranch, GitBranchPlus, ChevronRight, ArrowUpRight } = experimental_icons();
	const [view, setView] = useState<"main" | "branch" | "environment">("main");
	const { branches, environments = [] } = experimental_workspaceServices().experimental_useWorkspaceOptions(cwd);
	const [query, setQuery] = useState("");
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
						experimental_controllers().experimental_showSettings("worktrees");
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
	const { Check } = experimental_icons();
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

/** Codex's "Commit or push" card: a new branch for a detached worktree, the message, then Commit, Commit and push, Push. */
export function CommitSheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const {
		experimental_Dialog: Dialog,
		experimental_GitTotals: Totals,
		experimental_Kbd: Kbd,
		experimental_Menu: Menu,
		experimental_MenuTrigger: MenuTrigger,
		experimental_MenuContent: MenuContent,
		experimental_MenuRadioGroup: MenuRadioGroup,
		experimental_MenuRadioItem: MenuRadioItem,
	} = experimental_controls();
	const { GitBranch, ChevronDown, GitCommitHorizontal, CloudUpload } = experimental_icons();
	const { experimental_matches: matches } = experimental_shellServices();
	const target = checkout(thread);
	const workspace = experimental_workspaceServices();
	const { status, totals, operation, operations } = workspace.experimental_useGit(target, {
		status: true,
		totals: true,
		once: true,
	});
	const git = workspace.experimental_git(target);
	const [newBranch, setNewBranch] = useState(true);
	const { branch, setBranch } = useSuggestedBranch(thread.name);
	const [message, setMessage] = useState("");
	const [includeUnstaged, setIncludeUnstaged] = useState(true);
	const [sending, setSending] = useState(false);
	const busy = sending || operation?.status === "running";
	const recover = operations.find((op) => op.kind === "commitAndPush" || op.kind === "commit");
	const onBranch = status?.branch ?? recover?.outputs.branch;
	const detached = status !== undefined && !onBranch;
	const run = async (push: boolean, commit: boolean) => {
		if (busy || operation?.recovery === "reconcile" || operation?.recovery === "retry") return;
		setSending(true);
		try {
			const action: experimental_GitAction = commit
				? {
						kind: push ? "commitAndPush" : "commit",
						branch: detached && newBranch ? branch : undefined,
						message: message.trim() ? message : undefined,
						includeUnstaged,
					}
				: { kind: "push" };
			const result = await git.experimental_run(action);
			if (result?.status === "completed") onClose();
			else showOperationProblem(result);
		} finally {
			setSending(false);
		}
	};
	const mod = experimental_shellServices().experimental_platform === "darwin" ? "⌘" : "Ctrl";
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
					<GitBranch size={15} /> <span className="ps-1">{onBranch ?? "…"}</span>
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
					if (!matches(e, "desktop.composer.steer")) return;
					e.preventDefault();
					void run(false, true);
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
				disabled={busy || operation?.recovery === "retry"}
				hint={<Kbd>{mod}+⏎</Kbd>}
				onClick={() => void run(false, true)}
			/>
			<ActionRow
				icon={<CloudUpload size={15} />}
				label="Commit and push"
				disabled={busy || operation?.recovery === "retry"}
				onClick={() => void run(true, true)}
			/>
			<ActionRow
				icon={<CloudUpload size={15} />}
				label="Push"
				disabled={
					busy || operation?.recovery === "retry" || !onBranch || (status?.ahead === 0 && Boolean(status.upstream))
				}
				onClick={() => void run(true, false)}
			/>
			<Recovery target={target} operation={operation} />
		</Dialog>
	);
}

/** "Work here": Codex's dialog that turns a detached worktree into a branch. */
export function CreateBranchDialog({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const { experimental_Dialog: Dialog } = experimental_controls();
	const { GitBranch } = experimental_icons();
	const { experimental_matches: matches } = experimental_shellServices();
	const { experimental_notify: toast } = experimental_controllers();
	const { branch: name, setBranch: setName } = useSuggestedBranch(thread.name);
	const [error, setError] = useState<string>();
	const workspace = experimental_workspaceServices();
	const target = checkout(thread);
	const git = workspace.experimental_git(target);
	const { operation } = workspace.experimental_useGit(target, {});
	const create = async () => {
		const result = await git.experimental_run({ kind: "createBranch", name });
		if (result?.status === "completed") {
			toast(`Created ${result.outputs.branch}`, "success");
			onClose();
		} else setError(result?.problem?.message);
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
					onClick={() => experimental_controllers().experimental_showSettings("worktrees")}
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
			<Recovery target={target} operation={operation} />
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
	const {
		experimental_Dialog: Dialog,
		experimental_ListCaption: ListCaption,
		experimental_ListRow: ListRow,
		experimental_ListSeparator: ListSeparator,
	} = experimental_controls();
	const { GitBranch, Plus } = experimental_icons();
	const { experimental_basename: basename } = experimental_shellServices();
	const { experimental_notify: toast } = experimental_controllers();
	const target = checkout(thread);
	const workspace = experimental_workspaceServices();
	const { branches, operation } = workspace.experimental_useGit(target, { branches: true });
	const git = workspace.experimental_git(target);
	const [query, setQuery] = useState("");
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
									void git.experimental_run({ kind: "switchBranch", name: b }).then((result) => {
										if (result?.status === "completed") {
											toast(`Switched to ${b}`, "success");
											onClose();
										} else showOperationProblem(result);
									})
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
				<Recovery target={target} operation={operation} />
			</div>
		</Dialog>
	);
}

/** Codex's pull request card: branch → base, title, description, then draft or ready. */
export function PullRequestSheet({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const {
		experimental_Dialog: Dialog,
		experimental_GitTotals: Totals,
		experimental_Kbd: Kbd,
	} = experimental_controls();
	const { ArrowUpRight, GitPullRequest, GitPullRequestDraft } = experimental_icons();
	const { experimental_matches: matches } = experimental_shellServices();
	const target = checkout(thread);
	const workspace = experimental_workspaceServices();
	const { status, totals, branches, operation, operations } = workspace.experimental_useGit(target, {
		status: true,
		totals: true,
		branches: true,
		once: true,
	});
	const git = workspace.experimental_git(target);
	const base = branches?.defaultBranch;
	const { branch, setBranch } = useSuggestedBranch(thread.name);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [commitFirst, setCommitFirst] = useState(true);
	const [sending, setSending] = useState(false);
	const busy = sending || operation?.status === "running";
	const pr = operations.find((op) => op.kind === "pullRequest");
	const url = pr?.outputs.url;
	const onBranch = status?.branch ?? pr?.outputs.branch;
	const detached = status !== undefined && !onBranch;
	const create = async (draft: boolean) => {
		if (busy || operation?.recovery === "reconcile" || operation?.recovery === "retry") return;
		setSending(true);
		try {
			const result = await git.experimental_run({
				kind: "pullRequest",
				branch: detached ? branch : undefined,
				commitFirst,
				hasChanges: totals && totals.additions + totals.deletions > 0,
				title: title.trim() ? title : undefined,
				body: body.trim() ? body : undefined,
				draft,
			});
			showOperationProblem(result);
		} finally {
			setSending(false);
		}
	};
	const mod = experimental_shellServices().experimental_platform === "darwin" ? "⌘" : "Ctrl";
	return (
		<Dialog variant="card" title="Create pull request" onClose={onClose}>
			<div className="px-3 pt-2 text-base leading-6 text-tertiary">
				{detached ? "New branch" : (onBranch ?? "…")} → {base ?? "…"}
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
				onKeyDown={(e) => {
					if (!matches(e, "desktop.composer.steer")) return;
					e.preventDefault();
					void create(false);
				}}
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
				disabled={busy || operation?.recovery === "retry"}
				onClick={() => void create(true)}
			/>
			<ActionRow
				icon={<GitPullRequest size={15} />}
				label={busy ? "Creating…" : "Create PR"}
				disabled={busy || operation?.recovery === "retry"}
				hint={<Kbd>{mod}+⏎</Kbd>}
				onClick={() => void create(false)}
			/>
			<ActionRow
				icon={<ArrowUpRight size={15} />}
				label="Open PR in browser"
				disabled={!url}
				onClick={() => url && pr && void git.experimental_openPullRequest(pr.id)}
			/>
			<Recovery target={target} operation={operation} />
		</Dialog>
	);
}

/**
 * Codex's "Bring changes back to local checkout" (and its reverse): the branch the main checkout gets, where the
 * changes go, and the server's refusal ("Stash or commit your local changes to hand off") verbatim. It
 * checks before the user confirms: a dry run on open and 250 ms after each branch edit keeps "Bring changes back"
 * off while it runs or refuses. The confirm still sends the real handoff, whose own refusal shows the same way.
 */
export function HandoffDialog({ thread, onClose }: { thread: Thread; onClose: () => void }) {
	const { experimental_Dialog: Dialog } = experimental_controls();
	const { ArrowLeftRight } = experimental_icons();
	const { experimental_basename: basename } = experimental_shellServices();
	const toLocal = thread.workspace.mode === "worktree";
	const to = toLocal ? "local" : "worktree";
	const { branch, setBranch, edited } = useSuggestedBranch(thread.name);
	const target = checkout(thread);
	const workspace = experimental_workspaceServices();
	const { status, operation } = workspace.experimental_useGit(target, { status: true });
	const main = toLocal ? thread.projectCwd : thread.cwd;
	const sent = toLocal && !status?.branch && edited ? branch : undefined;
	const action = { kind: "handoff", to, branch: sent } as const;
	const [error, setError] = useState<{ branch?: string; problem: NonNullable<experimental_Operation["problem"]> }>();
	const [sending, setSending] = useState(false);
	const busy = sending || operation?.status === "running";
	const verdict = workspace.experimental_useHandoffCheck(target, action);
	const checking = verdict.status === "checking";
	const refused = verdict.status === "refused" ? verdict.problem : undefined;
	const problem = (error?.branch === sent ? error?.problem : undefined) ?? refused;
	const shown = problem && { message: problem.recoveryInstructions?.[0] ?? problem.message, paths: problem.paths };
	const go = async () => {
		if (busy || checking || refused || operation?.recovery === "reconcile") return;
		setSending(true);
		setError(undefined);
		try {
			const result = await workspace.experimental_git(target).experimental_run(action);
			if (result?.status === "completed") onClose();
			else if (result?.problem) setError({ branch: sent, problem: result.problem });
		} finally {
			setSending(false);
		}
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
			{/* A 44px full-width confirm, off while its check runs or refuses. */}
			<Button
				variant="solid"
				pill
				block
				disabled={busy || checking || refused !== undefined}
				onClick={() => void go()}
				className="mt-5 h-11 text-base font-medium"
			>
				{busy ? "Moving changes…" : toLocal ? "Bring changes back" : "Move to worktree"}
			</Button>
			{shown ? (
				<div className="mt-3 text-center text-base leading-6 text-danger-text">
					<p>{shown.message}</p>
					{shown.paths ? (
						<p className="mt-1 truncate text-sm text-tertiary">
							{shown.paths.slice(0, 3).join(", ")}
							{shown.paths.length > 3 ? ` and ${shown.paths.length - 3} more` : ""}
						</p>
					) : null}
				</div>
			) : null}
			<Recovery target={target} operation={operation} />
		</Dialog>
	);
}
