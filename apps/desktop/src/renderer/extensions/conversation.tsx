/** Explicit thread reads, mediated conversation actions and host-owned request recovery. */
import type {
	experimental_ConversationServices,
	experimental_CommandContext,
	experimental_Request,
	experimental_ViewItem,
} from "@knightcodeai/cli/desktop";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActiveRow, ToolRow, ActivityGroup, BackgroundNotices } from "../components/activity.tsx";
import { ToolPatch } from "./tool-patch.tsx";
import { Totals } from "../components/changes.tsx";
import { Markdown } from "../components/markdown.tsx";
import { ViewNode } from "../components/view.tsx";
import { McpAppCard } from "../components/mcp-app.tsx";
import { ThreadSummary } from "../components/git.tsx";
import { Button } from "../components/button.tsx";
import { basename } from "../format.ts";
import { dialogTitle, dialogOption, backgroundStateOf } from "../activity.ts";
import {
	answerApproval,
	answerDialog,
	answerQuestions,
	copyText,
	fork,
	resendEdited,
	showChanges,
	undoTurnEdits,
	useStore,
	getState,
	selectUnread,
	copyLastCodeBlock,
	loadEarlier,
	setPanel,
	setFinding,
	openFileTab,
} from "../store.ts";
import { desktopExtensions } from "./runtime.ts";
import { externalState } from "./external.ts";
import { SurfaceEntry, SurfaceHost } from "./surface.tsx";

const EMPTY: { key: string; text: string }[] = [];
const RenderingItems = createContext<readonly string[]>([]);
const transcripts = new Map<string, { scroll(to: "top" | "bottom"): void }>();

/** Scroller disposal revokes captured find/scroll callbacks instead of redirecting them to another thread. */
export function bindTranscript(threadId: string, binding: { scroll(to: "top" | "bottom"): void }) {
	transcripts.set(threadId, binding);
	return () => {
		if (transcripts.get(threadId) === binding) transcripts.delete(threadId);
	};
}

export const conversationServices: experimental_ConversationServices = {
	experimental_useThread: (id) => useStore((s) => s.held[id]),
	experimental_useHeader: (id) => {
		const thread = useStore((s) => s.held[id]?.thread);
		const summary = useStore((s) => s.threads.find((t) => t.id === id));
		const statuses = useStore((s) => s.held[id]?.ui.statuses ?? EMPTY);
		const pinned = useStore((s) => s.desktop?.pinnedThreads.includes(id) ?? false);
		const unread = useStore((s) => selectUnread(s).includes(id));
		const panelOpen = useStore((s) => s.panel.open);
		const cwd = thread?.cwd ?? summary?.cwd ?? "";
		return {
			name: thread?.name || summary?.name || "Untitled",
			cwd,
			project: basename(thread?.projectCwd ?? summary?.projectCwd ?? cwd),
			workspaceMode: thread?.workspace.mode ?? summary?.workspaceMode ?? "local",
			statuses,
			sessionFile: thread?.sessionFile,
			pinned,
			unread,
			panelOpen,
		};
	},
	experimental_useTurnStatus: (id) => {
		const idle = useStore((s) => !s.held[id]?.turns.some((t) => t.status === "inProgress"));
		const cwd = useStore((s) => s.held[id]?.thread.cwd ?? "");
		const workingVisible = useStore((s) => s.held[id]?.ui.workingVisible !== false);
		const workingMessage = useStore((s) => s.held[id]?.ui.workingMessage);
		return { idle, cwd, workingVisible, workingMessage };
	},
	experimental_useUndone: (id) => useStore((s) => s.undoneTurns[id] === true),
	experimental_readThread: (id) => getState().held[id],
	experimental_useBackgroundState: (threadId, id) =>
		useStore((s) => {
			const view = threadId ? s.held[threadId] : undefined;
			return view && id ? backgroundStateOf(view.backgroundShells, view.turns, id) : undefined;
		}),
	experimental_openFile: (id, path, line) => {
		if (!id || !getState().held[id]) return false;
		openFileTab(id, path, line);
		return true;
	},
	experimental_ToolPatch: ToolPatch,
	experimental_Totals: Totals,
	experimental_useRequest: (id) => useStore((s) => s.held[id]?.requests[0]),
	experimental_dialogTitle: dialogTitle,
	experimental_dialogOption: dialogOption,
	experimental_copyText: copyText,
	experimental_fork: fork,
	experimental_resendEdited: resendEdited,
	experimental_showChanges: showChanges,
	experimental_undoTurnEdits: undoTurnEdits,
	experimental_answerApproval: answerApproval,
	experimental_answerDialog: answerDialog,
	experimental_answerQuestions: answerQuestions,
	experimental_setPanelOpen: (open) => setPanel({ open }),
	experimental_copyLastCodeBlock: copyLastCodeBlock,
	experimental_loadEarlier: loadEarlier,
	experimental_find: (id, open) => {
		if (!transcripts.has(id)) return false;
		setFinding(open);
		return true;
	},
	experimental_scroll: (id, to) => {
		const binding = transcripts.get(id);
		if (!binding) return false;
		binding.scroll(to);
		return true;
	},
	experimental_Markdown: Markdown,
	experimental_ViewNode: ViewNode,
	experimental_McpAppCard: McpAppCard,
	experimental_ThreadSummary: ({ threadId, anchor }) => {
		const thread = useStore((s) => s.held[threadId]?.thread);
		return thread ? <ThreadSummary thread={thread} anchor={anchor} /> : null;
	},
	experimental_ActiveRow: ActiveRow,
	experimental_ToolRow: ToolRow,
	experimental_ActivityGroup: ActivityGroup,
	experimental_BackgroundNotices: BackgroundNotices,
};

function contextFor(id?: string): experimental_CommandContext {
	const state = getState();
	const thread = id ? state.held[id]?.thread : undefined;
	return {
		sidebarOpen: state.sidebarOpen,
		...(id ? { thread: { id, cwd: thread?.cwd ?? "" }, cwd: thread?.cwd } : {}),
	};
}

/** Match per-item renderers without subscribing the streaming path to unrelated store fields. */
export function ItemRenderer({
	threadId,
	item,
	children,
}: {
	threadId?: string;
	item: experimental_ViewItem;
	children: ReactNode;
}) {
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	const mounting = useContext(RenderingItems);
	const context = { ...contextFor(threadId), item };
	const key = `${context.thread?.id ?? ""}:${item.id}`;
	const entry = mounting.includes(key) ? undefined : desktopExtensions.slots("transcriptItem", context)[0];
	return entry ? (
		<RenderingItems.Provider value={[...mounting, key]}>
			<SurfaceEntry entry={entry} context={context} fallback={children} />
		</RenderingItems.Provider>
	) : (
		children
	);
}

export function MessageActions({ threadId, item }: { threadId: string; item: experimental_ViewItem }) {
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	const context = { ...contextFor(threadId), item };
	return (
		<>
			{desktopExtensions.slots("messageActions", context).map((entry) => (
				<SurfaceEntry key={entry.sequence} entry={entry} context={context} />
			))}
		</>
	);
}

/** Mount the header on the same public provider path with an explicit thread context. */
export function ThreadHeaderSurface({ threadId }: { threadId: string }) {
	const preferences = useSyncExternalStore(externalState.subscribe, externalState.getProviders);
	return (
		<SurfaceHost
			registry={desktopExtensions}
			surface="threadHeader"
			builtin="builtin.thread-header/default"
			preferred={preferences.window.threadHeader ?? preferences.app.threadHeader}
			context={contextFor(threadId)}
		/>
	);
}

function RequestShell({ threadId, request }: { threadId: string; request: experimental_Request }) {
	const preferences = useSyncExternalStore(externalState.subscribe, externalState.getProviders);
	const [recover, setRecover] = useState(false);
	const preferred = preferences.window.requests ?? preferences.app.requests;
	const context = { ...contextFor(threadId), request };
	return (
		<>
			<SurfaceHost
				registry={desktopExtensions}
				surface="requests"
				builtin="builtin.requests/default"
				preferred={recover ? undefined : preferred}
				context={context}
			/>
			{preferred && preferred !== "builtin.requests/default" && !recover ? (
				<div className="mx-auto max-w-3xl px-4">
					<Button size="xs" onClick={() => setRecover(true)}>
						Use default request controls
					</Button>
				</div>
			) : null}
		</>
	);
}

/** Request order and the recovery shell remain host-owned; drawing a request grants no approval authority. */
export function RequestsSurface({ threadId }: { threadId: string }) {
	const request = useStore((s) => s.held[threadId]?.requests[0]);
	return request ? <RequestShell key={String(request.id)} threadId={threadId} request={request} /> : null;
}
