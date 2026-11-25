/**
 * Worktrees and git in the desktop (desktop-shell.md section 9.6), after Codex's: the composer's "Configure local
 * environment" popover, a thread's summary with its Actions and Git actions menus, and the commit, branch, pull
 * request and handoff dialogs.
 */

import type { Thread } from "@knightcode/app-server-protocol";
import { experimental_workspaceServices, type experimental_Checkout } from "@knightcodeai/cli/desktop";
import { AppWindow, FileDiff, GitBranch, Globe, ListTodo, MoreHorizontal, Plus, SquareTerminal } from "./icons.tsx";
import { type ReactNode, type RefObject, useMemo, useState } from "react";
import { threadSources } from "../activity.ts";
import { client } from "../client.ts";
import { basename } from "../format.ts";
import { matches } from "../keys.ts";
import { navigate, openBackgroundShellTab, refreshDiff, showChanges, toast, useStore } from "../store.ts";
import { BackgroundProcessesSection, useBackgroundStart } from "./background-terminals.tsx";
import { Button, IconButton } from "./button.tsx";
import { Dialog } from "./dialog.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./menu.tsx";
import { ListCaption, Popover } from "./popover.tsx";

import {
	CommitSheet,
	CreateBranchDialog,
	SwitchBranchSheet,
	PullRequestSheet,
	HandoffDialog,
} from "../builtins/workspace/dialogs.tsx";
export {
	WorkspacePopover,
	CommitSheet,
	CreateBranchDialog,
	SwitchBranchSheet,
	PullRequestSheet,
	HandoffDialog,
} from "../builtins/workspace/dialogs.tsx";

function checkout(thread: Thread): experimental_Checkout {
	return { threadId: thread.id, cwd: thread.cwd, projectCwd: thread.projectCwd };
}

type SheetKind = "commit" | "branch" | "switch" | "pr" | "handoff";

/** The summary's body: the project and its Actions, then Changes with Git actions on hover (both menus drop below). */
/** An image a source row opens, shown over the window. */
type Preview = { src: string; label: string };

/**
 * The summary's "Sources": a count, then a row for each image the user attached (an
 * 18px thumbnail, opening the image), each MCP server whose tools ran, and "Web search" when the agent used the web.
 */
function SourcesSection({ threadId, onImage }: { threadId: string; onImage: (preview: Preview) => void }) {
	const turns = useStore((s) => s.held[threadId]?.turns);
	const sources = useMemo(() => threadSources(turns ?? []), [turns]);
	const count = sources.images.length + sources.servers.length + (sources.web ? 1 : 0);
	if (count === 0) return null;
	const row = "flex h-[34px] w-full items-center gap-2.5 rounded-xl ps-3 text-start text-base text-ink";
	return (
		<>
			<div className="mt-1 flex h-9 items-center gap-1.5 ps-3 text-sm text-tertiary">
				Sources <span className="tabular-nums">{count}</span>
			</div>
			{sources.images.map((image, i) => {
				const src = `data:${image.mimeType};base64,${image.data}`;
				const label = `Image ${i + 1}`;
				return (
					<button
						key={i}
						type="button"
						onClick={() => onImage({ src, label })}
						className={`${row} hover:bg-ghost-hover`}
					>
						<img src={src} alt="" className="size-[18px] shrink-0 rounded-[3px] border border-line object-cover" />
						{label}
					</button>
				);
			})}
			{sources.servers.map((server) => (
				<div key={server} className={row}>
					<AppWindow size={16} className="shrink-0 text-secondary" />
					<span className="truncate">{server}</span>
				</div>
			))}
			{sources.web ? (
				<div className={row}>
					<Globe size={16} className="shrink-0 text-secondary" /> Web search
				</div>
			) : null}
		</>
	);
}

function SummaryBody({
	thread,
	closeSummary,
	open,
	onImage,
}: {
	thread: Thread;
	closeSummary: () => void;
	open: (kind: SheetKind) => void;
	onImage: (preview: Preview) => void;
}) {
	const { status } = experimental_workspaceServices().experimental_useGit(checkout(thread), { status: true });
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
						showChanges(thread.id);
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
			<BackgroundProcessesSection
				threadId={thread.id}
				onOpen={(shell) => {
					closeSummary();
					openBackgroundShellTab(thread.id, shell);
				}}
			/>
			<SourcesSection threadId={thread.id} onImage={onImage} />
		</div>
	);
}

/**
 * The thread's summary (Codex's "Toggle summary"): the project, its Actions and Git actions, and Changes. Like Codex's
 * it hangs from the header, not the button: 8px below it and 12px in from its end, so it slides out of that corner.
 */
export function ThreadSummary({ thread, anchor }: { thread: Thread; anchor: RefObject<HTMLElement | null> }) {
	const [sheet, setSheet] = useState<SheetKind>();
	// Outside the panel, which closes as the image opens.
	const [image, setImage] = useState<Preview>();
	// Commits, switches and handoffs change the checkout without a turn; reload an open Changes pane.
	const close = () => {
		setSheet(undefined);
		refreshDiff(thread.id);
	};
	const [open, setOpen] = useState(false);
	// A command starting in the background opens the summary on its "Background processes", leaving the focus where
	// it is (the composer). Not over any dialog, sheet or other panel (all role="dialog"), nor while the header it hangs
	// from is hidden (a full-screen panel).
	const [popped, setPopped] = useState(false);
	useBackgroundStart(thread.id, () => {
		if (open || document.querySelector('[role="dialog"]') || !anchor.current?.checkVisibility()) return;
		setPopped(true);
		setOpen(true);
	});
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
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					setPopped(false);
				}}
				takeFocus={!popped}
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
						onImage={(preview) => {
							closeSummary();
							setImage(preview);
						}}
					/>
				)}
			</Popover>
			{image ? (
				<Dialog title={image.label} onClose={() => setImage(undefined)} width={720}>
					<img src={image.src} alt={image.label} className="max-h-[70vh] w-full rounded-lg object-contain" />
				</Dialog>
			) : null}
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
			onClick={() => showChanges(threadId)}
			className="inline-flex max-w-[320px] items-center gap-1 rounded-md border border-line bg-panel px-2 py-1.5 text-sm text-ink"
		>
			<FileDiff size={14} className="text-tertiary" />
			<span className="pe-1 font-medium">
				{count} comment{count === 1 ? "" : "s"}
			</span>
		</button>
	);
}
