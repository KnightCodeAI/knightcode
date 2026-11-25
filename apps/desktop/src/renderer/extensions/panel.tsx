/** Mediated panel intents; the existing tab, draft, native process and guest hosts own their state. */
import type {
	experimental_Checkout,
	experimental_CommandContext,
	experimental_PanelServices,
} from "@knightcodeai/cli/desktop";
import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { client } from "../client.ts";
import { samePath } from "../format.ts";
import type { State } from "../store.ts";
import { type AppItem, McpAppView } from "../components/mcp-app.tsx";
import { PreviewTab } from "../components/preview.tsx";
import { openIn } from "../components/open-in.tsx";
import { BottomRegion } from "../components/terminal.tsx";
import {
	activateTab,
	activateTerminal,
	closeTab,
	closeTerminal,
	getState,
	newTerminal,
	NO_TABS,
	NO_TERMINALS,
	openAppTab,
	openFileTab,
	openPreview,
	saveFileDraft,
	selectPanelContribution,
	setFileDraft,
	setPanel,
	setTerminalsOpen,
	useStore,
	type PanelTab,
} from "../store.ts";
import { desktopExtensions } from "./runtime.ts";
import { SurfaceEntry } from "./surface.tsx";
import { externalState } from "./external.ts";
import { STRUCTURAL_BUILTINS } from "./providers.ts";

export function appItemOf(threadId: string, itemId: string) {
	return (s: State) =>
		s.held[threadId]?.turns
			.flatMap((t) => t.items)
			.find((i): i is AppItem => i.id === itemId && i.type === "toolCall" && i.mcpApp !== undefined);
}

export const tabId = (tab: PanelTab) => {
	switch (tab.kind) {
		case "file":
			return `file:${tab.path}`;
		case "mcpApp":
			return `app:${tab.itemId}`;
		case "backgroundShell":
			return `background:${tab.id}`;
		case "preview":
			return tab.id;
		default:
			return tab.kind;
	}
};

function current(target: experimental_Checkout): boolean {
	const thread = getState().held[target.threadId]?.thread;
	return !!thread && samePath(thread.cwd, target.cwd) && samePath(thread.projectCwd, target.projectCwd);
}

export function workspaceContext(target: experimental_Checkout, sidebarOpen: boolean): experimental_CommandContext {
	return { workspace: target, sidebarOpen, cwd: target.cwd, thread: { id: target.threadId, cwd: target.cwd } };
}

const EditorContent = createContext<ReactNode>(null);
function EditorHost() {
	return useContext(EditorContent);
}

export function panelServices(signal: AbortSignal, admitted = () => !signal.aborted): experimental_PanelServices {
	return {
		experimental_panel(target) {
			const { threadId, cwd } = target;
			const allowed = () => admitted() && current(target);
			const contextual = () => workspaceContext(target, getState().sidebarOpen);
			const oper = (operation: () => void) => {
				if (!allowed()) return false;
				operation();
				return true;
			};
			const indexOf = (id: string) => (getState().tabs[threadId] ?? NO_TABS).tabs.findIndex((tab) => tabId(tab) === id);
			const terminalIndex = (id: string) =>
				(getState().terminals[threadId] ?? NO_TERMINALS).tabs.findIndex((tab) => tab.terminalId === id);
			return {
				experimental_openFile(path, line, opener) {
					if (!allowed()) return false;
					if (!opener) {
						openFileTab(threadId, path, line);
						return true;
					}
					const intent = { target, path, line };
					const entry = desktopExtensions.fileOpeners(intent).find((entry) => entry.id === opener);
					const context = { ...contextual(), file: intent };
					const tab =
						entry &&
						desktopExtensions
							.panelTabs(context)
							.find(
								(tab) => tab.id === `${entry.owner}/${entry.contribution.tab}` && desktopExtensions.isAdmitted(tab),
							);
					return !!tab && oper(() => selectPanelContribution(threadId, { id: tab.id, file: { path, line } }));
				},
				experimental_openPreview: (url) => oper(() => openPreview(threadId, url)),
				experimental_openApp: (id) =>
					allowed() && !!appItemOf(threadId, id)(getState()) && oper(() => openAppTab(threadId, id)),
				experimental_select(id) {
					if (!allowed()) return false;
					const index = indexOf(id);
					if (index >= 0) return oper(() => activateTab(threadId, index));
					return (
						desktopExtensions
							.panelTabs(contextual())
							.some((entry) => entry.id === id && desktopExtensions.isAdmitted(entry)) &&
						oper(() => selectPanelContribution(threadId, { id }))
					);
				},
				experimental_close(id) {
					if (!allowed()) return false;
					if (getState().panelContributions[threadId]?.id === id) return oper(() => selectPanelContribution(threadId));
					const index = indexOf(id);
					return index > 0 && oper(() => closeTab(threadId, index));
				},
				experimental_setVisible: (open) =>
					getState().view.kind === "thread" &&
					(getState().view as { id: string }).id === threadId &&
					oper(() => setPanel({ open })),
				experimental_readFile: async (path) => {
					if (!allowed()) return;
					const result = await client.request("file/read", { threadId, path });
					return allowed() ? result : undefined;
				},
				experimental_listFiles: async (path) => {
					if (!allowed()) return;
					const result = await client.request("file/list", { threadId, path });
					return allowed() ? result : undefined;
				},
				experimental_readDiff: async (scope) => {
					if (!allowed()) return;
					const result = await client.request("thread/diff/read", { threadId, scope });
					return allowed() ? result : undefined;
				},
				experimental_setFileDraft: (path, draft) => oper(() => setFileDraft(threadId, path, draft)),
				experimental_saveFile: async (path) => {
					if (!allowed()) return;
					const draft = await saveFileDraft(threadId, path, allowed, cwd);
					return allowed() ? draft : undefined;
				},
				experimental_openExternally: (path, application, line) => oper(() => openIn(application, path, line)),
				experimental_fileOpeners: (path) =>
					allowed()
						? desktopExtensions
								.fileOpeners({ target, path })
								.map(({ id, contribution }) => ({ id, label: contribution.label }))
						: [],
				experimental_newTerminal: async (shell) => {
					if (allowed()) await newTerminal(threadId, cwd, shell);
				},
				experimental_terminalShells: async () => {
					if (!allowed()) return [];
					const { shells } = await client.host("host/terminal/shells", {});
					return allowed() ? shells : [];
				},
				experimental_showTerminal: (open) => oper(() => setTerminalsOpen(threadId, open)),
				experimental_selectTerminal: (id) =>
					terminalIndex(id) >= 0 && oper(() => activateTerminal(threadId, terminalIndex(id))),
				experimental_closeTerminal: (id) =>
					terminalIndex(id) >= 0 && oper(() => closeTerminal(threadId, terminalIndex(id))),
				experimental_stopBackgroundShell: async (id) => {
					if (!allowed()) return false;
					const { stopped } = await client.request("thread/backgroundShells/stop", { threadId, id });
					return allowed() && stopped;
				},
			};
		},
		experimental_usePanel(target) {
			const { threadId } = target;
			const { tabs, active } = useStore((s) => s.tabs[threadId] ?? NO_TABS);
			const selection = useStore((s) => s.panelContributions[threadId]);
			const open = useStore((s) => s.panel.open && s.view.kind === "thread" && s.view.id === threadId);
			const sidebar = useStore((s) => s.sidebarOpen);
			useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot, desktopExtensions.getSnapshot);
			const contributions = desktopExtensions
				.panelTabs(workspaceContext(target, sidebar))
				.filter((entry) => desktopExtensions.isAdmitted(entry))
				.map(({ id, contribution }) => ({ id, label: contribution.label }));
			return {
				open,
				active: contributions.some((tab) => tab.id === selection?.id) ? selection!.id : tabId(tabs[active] ?? tabs[0]!),
				tabs: tabs.map((tab) =>
					tab.kind === "file"
						? { kind: tab.kind, path: tab.path, draft: tab.draft, preview: !!tab.preview, id: tabId(tab) }
						: { ...tab, id: tabId(tab) },
				),
				contributions,
			};
		},
		experimental_useTerminals({ threadId }) {
			const { tabs, active, open } = useStore((s) => s.terminals[threadId] ?? NO_TERMINALS);
			return { open, active: tabs[active]?.terminalId, terminals: tabs };
		},
		experimental_EditorHost: EditorHost,
		experimental_TerminalHost: TerminalHost,
		experimental_PreviewHost: PreviewHost,
		experimental_McpAppHost: AppHost,
	};
}

export function AppHost({ target, itemId }: { target: experimental_Checkout; itemId: string }) {
	const item = useStore(appItemOf(target.threadId, itemId));
	if (!item || !current(target))
		return <div className="p-4 text-sm text-tertiary">This app's call is no longer in the thread.</div>;
	return (
		<div className="flex min-h-0 flex-1 flex-col p-2">
			<McpAppView threadId={target.threadId} item={item} mode="fullscreen" />
		</div>
	);
}

export function PreviewHost({ target, id, active }: { target: experimental_Checkout; id: string; active: boolean }) {
	const tab = useStore((s) => s.tabs[target.threadId]?.tabs.find((tab) => tab.kind === "preview" && tab.id === id));
	if (tab?.kind !== "preview" || !current(target)) return null;
	return <PreviewTab threadId={target.threadId} tab={tab} active={active} />;
}

export function TerminalHost({ target }: { target: experimental_Checkout }) {
	if (!current(target)) return null;
	return <BottomRegion threadId={target.threadId} cwd={target.cwd} />;
}

/** File controls and the default editor remain host-owned when a renderer is selected. */
export function WorkspaceSurface({
	target,
	surface,
	file,
	children,
}: {
	target: experimental_Checkout;
	surface: "code" | "diff" | "terminal";
	file?: { path: string; line?: number };
	children: ReactNode;
}) {
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot, desktopExtensions.getSnapshot);
	const sidebar = useStore((s) => s.sidebarOpen);
	const preferences = useSyncExternalStore(externalState.subscribe, externalState.getProviders);
	const preferred = preferences.window[surface] ?? preferences.app[surface];
	const context = { ...workspaceContext(target, sidebar), file: file && { target, ...file } };
	const entry = desktopExtensions.resolveProvider(surface, STRUCTURAL_BUILTINS[surface], preferred, context);
	if (!entry || !desktopExtensions.isAdmitted(entry)) return children;
	return (
		<EditorContent.Provider value={children}>
			<SurfaceEntry key={entry.sequence} entry={entry} context={context} fallback={children} />
		</EditorContent.Provider>
	);
}
