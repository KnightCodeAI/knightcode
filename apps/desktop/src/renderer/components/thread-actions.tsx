/**
 * A thread's actions, listed once for the thread header's menu (Radix), a sidebar row's native context menu and the
 * open thread's shortcuts (useBindings), in Codex's order: Rename, Pin, Mark as unread, then Fork › (and Compact for
 * an open thread), Copy ›, Show in folder, Open in new window, Archive and Delete. The rename dialog is Codex's
 * "Rename chat"; deleting asks first (DeleteThreadDialog).
 */

import { type ComponentType, useState } from "react";
import type { KeybindingId } from "../../shared/keybindings.ts";
import { client } from "../client.ts";
import { threadLink } from "../routes.ts";
import {
	archive,
	compact,
	copyText,
	deleteThread,
	fork,
	openInNewWindow,
	pinThread,
	rename,
	setUnread,
	transcriptMarkdown,
	useStore,
} from "../store.ts";
import { Button } from "./button.tsx";
import { ConfirmDialog, Dialog, DialogActions } from "./dialog.tsx";
import {
	AppWindow,
	Archive,
	CollapseAll,
	Copy,
	FolderOpen,
	GitBranch,
	type IconProps,
	MailDot,
	Pencil,
	Pin,
	PinOff,
	Trash2,
} from "./icons.tsx";

export interface ThreadAction {
	label: string;
	icon?: ComponentType<IconProps>;
	binding?: KeybindingId;
	/** Drawn in the caution colour (Delete). */
	danger?: boolean;
	run: () => void;
}
export type ThreadActionItem =
	ThreadAction | "-" | { label: string; icon?: ComponentType<IconProps>; items: ThreadAction[] };

/**
 * `open` is true for the thread on screen: it can be compacted and copied as Markdown (both need its history), and
 * its session file is known. `onRename` and `onDelete` open the rename and delete dialogs for it.
 */
export function threadActions(
	thread: { id: string; cwd: string; sessionFile?: string },
	{
		pinned,
		unread,
		open,
		onRename,
		onDelete,
	}: { pinned: boolean; unread: boolean; open: boolean; onRename: () => void; onDelete: () => void },
): ThreadActionItem[] {
	const { id, cwd, sessionFile } = thread;
	return [
		{ label: "Rename", icon: Pencil, binding: "desktop.thread.rename", run: onRename },
		{
			label: pinned ? "Unpin" : "Pin",
			icon: pinned ? PinOff : Pin,
			binding: "desktop.thread.pin",
			run: () => pinThread(id, !pinned),
		},
		// As Codex's: the shortcut only marks unread; "Mark as read" has none.
		unread
			? { label: "Mark as read", icon: MailDot, run: () => setUnread(id, false) }
			: {
					label: "Mark as unread",
					icon: MailDot,
					binding: "desktop.thread.markUnread",
					run: () => setUnread(id, true),
				},
		"-",
		{
			label: "Fork",
			icon: GitBranch,
			items: [
				{ label: "Fork thread", binding: "desktop.thread.fork", run: () => void fork(id) },
				{ label: "Fork thread in new worktree", run: () => void fork(id, undefined, true) },
			],
		},
		...(open ? [{ label: "Compact context", icon: CollapseAll, run: () => void compact(id) }] : []),
		"-",
		{
			label: "Copy",
			icon: Copy,
			items: [
				{ label: "Copy deeplink", binding: "desktop.thread.copyDeeplink", run: () => void copyText(threadLink(id)) },
				...(open ? [{ label: "Copy as Markdown", run: () => void copyText(transcriptMarkdown(id)) }] : []),
				{ label: "Copy working directory", binding: "desktop.thread.copyCwd", run: () => void copyText(cwd) },
				...(sessionFile
					? [
							{
								label: "Copy conversation path",
								binding: "desktop.thread.copyPath" as const,
								run: () => void copyText(sessionFile),
							},
						]
					: []),
				{ label: "Copy thread id", run: () => void copyText(id) },
			],
		},
		{
			label: "Show in folder",
			icon: FolderOpen,
			run: () => void client.host("host/shell/showInFolder", { path: cwd }),
		},
		{
			label: "Open in new window",
			icon: AppWindow,
			binding: "desktop.thread.openWindow",
			run: () => openInNewWindow(id),
		},
		"-",
		{ label: "Archive", icon: Archive, binding: "desktop.thread.archive", run: () => void archive(id) },
		{ label: "Delete…", icon: Trash2, binding: "desktop.thread.delete", danger: true, run: onDelete },
	];
}

/** The actions with a shortcut, submenus flattened, for useBindings. */
export const boundActions = (items: ThreadActionItem[]): ThreadAction[] =>
	items.flatMap((item) => (item === "-" ? [] : "items" in item ? item.items : [item])).filter((a) => a.binding);

/** Codex's "Rename chat" dialog: the title in a field, Cancel and Save; Enter saves, Escape cancels. */
export function RenameThreadDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
	const current = useStore(
		(s) => s.threads.find((t) => t.id === threadId)?.name ?? s.held[threadId]?.thread.name ?? "",
	);
	const [name, setName] = useState(current);
	const save = () => {
		const value = name.trim();
		if (value && value !== current) void rename(threadId, value);
		onClose();
	};
	return (
		<Dialog title="Rename thread" description="Keep it short and recognizable" onClose={onClose}>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<div className="pt-3">
					<input
						aria-label="Thread title"
						placeholder="Add a title…"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onFocus={(e) => e.currentTarget.select()}
						className="kc-input"
					/>
				</div>
				<DialogActions>
					<Button variant="surface" size="lg" squircle className="px-4" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" variant="solid" size="lg" squircle className="px-4">
						Save
					</Button>
				</DialogActions>
			</form>
		</Dialog>
	);
}

/** Deleting a thread for good, live or archived: it asks first, naming the thread. */
export function DeleteThreadDialog({
	thread,
	onClose,
	onDeleted,
}: {
	thread: { id: string; name: string };
	onClose: () => void;
	onDeleted?: () => void;
}) {
	return (
		<ConfirmDialog
			title="Delete thread?"
			description={`This deletes “${thread.name || "Untitled"}” for good. It can't be undone.`}
			confirm="Delete"
			onConfirm={() => void deleteThread(thread.id).then(onDeleted)}
			onClose={onClose}
		/>
	);
}
