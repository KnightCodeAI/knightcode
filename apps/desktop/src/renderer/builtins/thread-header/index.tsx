/** Built-in thread identity, title editing and actions, entirely on public controllers. */
import { useRef, useState } from "react";
import {
	defineDesktopExtension,
	experimental_conversationServices,
	experimental_shellServices,
	experimental_controls,
	experimental_icons,
	experimental_controllers,
	experimental_Slots as Slots,
	type experimental_CommandContext,
} from "@knightcodeai/cli/desktop";
/** Codex's "Chat actions" menu: an icon on every row, the copies gathered under one Copy submenu (thread-actions.tsx). */
function ThreadMenu({ thread }: { thread: { id: string; cwd: string; name: string; sessionFile?: string } }) {
	const { id } = thread;
	const { experimental_useHeader: useHeader } = experimental_conversationServices();
	const { pinned, unread } = useHeader(id);
	const {
		experimental_threadMenu: threadActions,
		experimental_useBindings: useBindings,
		experimental_bindingLabel: bindingLabel,
	} = experimental_shellServices();
	const {
		experimental_Menu: Menu,
		experimental_MenuTrigger: MenuTrigger,
		experimental_MenuContent: MenuContent,
		experimental_MenuItem: MenuItem,
		experimental_MenuSub: MenuSub,
		experimental_MenuSeparator: MenuSeparator,
		experimental_IconButton: IconButton,
		experimental_RenameThreadDialog: RenameThreadDialog,
		experimental_DeleteThreadDialog: DeleteThreadDialog,
	} = experimental_controls();
	const { MoreHorizontal } = experimental_icons();
	const [dialog, setDialog] = useState<"rename" | "delete">();
	const items = threadActions(thread, {
		pinned,
		unread,
		open: true,
		onRename: () => setDialog("rename"),
		onDelete: () => setDialog("delete"),
	});
	// The open thread's shortcuts run the same actions as its menu, and Codex's "Copy last code block", which no menu
	// lists.
	useBindings([
		...items
			.flatMap((item) => (item === "-" ? [] : "items" in item ? item.items.filter((sub) => sub !== "-") : [item]))
			.filter((item) => item.binding),
		{
			binding: "desktop.thread.copyCode",
			run: () => {
				experimental_controllers().experimental_runCommand("builtin.composer/copy-code", {
					sidebarOpen: true,
					thread: { id, cwd: thread.cwd },
					composer: { threadId: id },
				});
			},
		},
	]);
	return (
		<>
			<Menu>
				<MenuTrigger>
					<IconButton label="Chat actions" className="no-drag">
						<MoreHorizontal size={16} />
					</IconButton>
				</MenuTrigger>
				<MenuContent align="end">
					{items.map((item, i) => {
						if (item === "-") return <MenuSeparator key={i} />;
						const Icon = item.icon;
						if ("items" in item)
							return (
								<MenuSub key={item.label} icon={Icon ? <Icon /> : undefined} label={item.label}>
									{item.items.map((sub, i) =>
										sub === "-" ? (
											<MenuSeparator key={i} />
										) : (
											<MenuItem
												key={sub.label}
												hint={sub.binding ? bindingLabel(sub.binding) : undefined}
												danger={sub.danger}
												onSelect={sub.run}
											>
												{sub.label}
											</MenuItem>
										),
									)}
								</MenuSub>
							);
						return (
							<MenuItem
								key={item.label}
								icon={Icon ? <Icon /> : undefined}
								hint={item.binding ? bindingLabel(item.binding) : undefined}
								danger={item.danger}
								onSelect={item.run}
							>
								{item.label}
							</MenuItem>
						);
					})}
				</MenuContent>
			</Menu>
			{dialog === "rename" ? <RenameThreadDialog threadId={id} onClose={() => setDialog(undefined)} /> : null}
			{dialog === "delete" ? <DeleteThreadDialog thread={thread} onClose={() => setDialog(undefined)} /> : null}
		</>
	);
}

function Header({ context }: { context: experimental_CommandContext }) {
	const id = context.thread?.id ?? "";
	const {
		experimental_useHeader: useHeader,
		experimental_ThreadSummary: ThreadSummary,
		experimental_setPanelOpen: setPanelOpen,
	} = experimental_conversationServices();
	const { name, cwd, project, workspaceMode, statuses, sessionFile, panelOpen } = useHeader(id);
	const { experimental_Tooltip: Tooltip, experimental_IconButton: IconButton } = experimental_controls();
	const { GitBranchPlus, Folder, SquarePlus } = experimental_icons();
	const { experimental_matches: matches } = experimental_shellServices();
	const header = useRef<HTMLElement>(null);
	const [renaming, setRenaming] = useState<string>();
	const commitRename = () => {
		const value = renaming?.trim();
		setRenaming(undefined);
		if (value && value !== name) void experimental_controllers().experimental_renameThread(id, value);
	};
	return (
		<header ref={header} className="flex h-[52px] shrink-0 items-center gap-2 ps-3.5 pe-1.5">
			<Tooltip content={cwd} side="bottom" align="start">
				<span
					role="img"
					aria-label={workspaceMode === "worktree" ? `Worktree of ${project}` : `Project: ${project}`}
					className="flex size-7 shrink-0 items-center justify-center text-tertiary"
				>
					{workspaceMode === "worktree" ? <GitBranchPlus size={16} /> : <Folder size={16} />}
				</span>
			</Tooltip>
			{renaming !== undefined ? (
				<input
					autoFocus
					aria-label="Thread title"
					value={renaming}
					onChange={(e) => setRenaming(e.target.value)}
					onBlur={commitRename}
					onKeyDown={(e) => {
						if (matches(e, "desktop.item.activate")) commitRename();
						if (matches(e, "desktop.picker.dismiss")) {
							e.preventDefault();
							setRenaming(undefined);
						}
					}}
					className="kc-input h-7 min-w-0 flex-1 text-base font-medium"
				/>
			) : (
				<Tooltip content={name} side="bottom" align="start" overflow>
					<button
						type="button"
						onDoubleClick={() => setRenaming(name)}
						className="min-w-0 truncate px-1.5 text-start text-base leading-6 font-medium text-ink"
					>
						{name}
					</button>
				</Tooltip>
			)}
			<Slots surface="threadHeaderTitle" context={context} />
			<div className="flex-1" />
			<Slots surface="threadHeaderStatuses" context={context} />
			{statuses.map((status) => (
				<Tooltip key={status.key} content={status.text} side="bottom">
					<span className="max-w-[200px] shrink truncate rounded-md border border-line px-2 text-sm text-secondary">
						{status.text}
					</span>
				</Tooltip>
			))}
			<Slots surface="threadHeaderRow" context={context} />
			<div className="flex items-center gap-1.5">
				<Slots surface="threadHeaderActions" context={context} />
				<ThreadMenu thread={{ id, cwd, name, sessionFile }} />
				<ThreadSummary threadId={id} anchor={header} />
				{panelOpen ? null : (
					<>
						<div className="mx-px h-4 w-px bg-line" />
						<IconButton label="Show tabs" className="no-drag" onClick={() => setPanelOpen(true)}>
							<SquarePlus size={16} />
						</IconButton>
					</>
				)}
			</div>
		</header>
	);
}
export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "default", surface: "threadHeader", experimental_render: Header });
});
