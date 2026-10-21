/**
 * One store per window (desktop-shell.md section 7.1): the sidebar slice from thread/list and sidebar
 * notifications, and per held thread its Thread, turns and items ordered by `index`, built from a
 * thread/resume snapshot plus notifications.
 */

import { useSyncExternalStore } from "react";
import type {
	ApprovalMode,
	ApprovalResult,
	DiffComment,
	DiffScope,
	ImageInput,
	Item,
	LoginState,
	PayloadRef,
	ResultOf,
	ServerRequestResult,
	ThinkingLevel,
	Thread,
	ThreadSummary,
	TokenUsage,
	Turn,
	TurnQueue,
	TurnSummary,
	WireItem,
	WireTurn,
	WorkspaceRequest,
} from "@knightcode/app-server-protocol";
import { DEFAULT_PREFERENCES, type DesktopState, type Preferences, SIDEBAR_WIDTH } from "../shared/host-protocol.ts";
import { DESKTOP_KEYBINDINGS, type KeybindingId } from "../shared/keybindings.ts";
import { type AnyNotification, type AnyServerRequest, client, RequestError } from "./client.ts";

export { RequestError };
import type { Customization, ThemeName } from "./appearance.ts";
import { inactiveThreads } from "./archive-filter.ts";
import { lastCodeBlock, samePath } from "./format.ts";
import { type SettingsPage, viewOfLink } from "./routes.ts";
import {
	DEFAULT_SIDEBAR_OPTIONS,
	nextNeedingAttention,
	recentThreads,
	type SidebarOptions,
	sidebarModel,
	stepThread,
	threadSlots,
} from "./sidebar-model.ts";
import { placeItem, toView, type ViewItem, type ViewTurn } from "./turns.ts";

export type ModelInfo = ResultOf<"model/list">["models"][number];
export type { ViewItem, ViewTurn };
/** A question the server waits on: an approval, or a dialog (ask_user, the classifier gate, plan review). */
export type ServerAsk = AnyServerRequest;
export type Approval = Extract<ServerAsk, { method: "item/toolCall/requestApproval" }>;
export type Dialog = Extract<ServerAsk, { method: "ui/dialog" }>;
export type UserInput = Extract<ServerAsk, { method: "item/toolCall/requestUserInput" }>;
export interface PendingMessage {
	clientMessageId: string;
	text: string;
	images?: ImageInput[];
	failed?: string;
}
export interface ThreadView {
	thread: Thread;
	turns: ViewTurn[];
	queue: TurnQueue;
	usage?: TokenUsage;
	/** Approvals and dialogs in the order they came; the first takes the composer's place. */
	requests: ServerAsk[];
	retry?: { attempt: number; maxAttempts: number; delayMs: number; error: string; at: number };
	pending: PendingMessage[];
	/** Older history: a thread/read cursor, absent once the first turn is loaded. */
	nextCursor?: string;
	notice?: string;
}

export type { SettingsPage };
export type View =
	{ kind: "thread"; id: string } | { kind: "new"; cwd?: string } | { kind: "settings"; page: SettingsPage };
export type Accounts = ResultOf<"account/list">;

export interface State {
	server: { state: "starting" | "ready" | "restarting" | "failed"; message?: string };
	/** Turns whose edits were undone (by turn id), so their card offers Reapply after it remounts. */
	undoneTurns: Record<string, true>;
	desktop: DesktopState | undefined;
	threads: ThreadSummary[];
	view: View;
	held: Record<string, ThreadView>;
	/** Why the last resume failed; `code` and `data` are the server's, when it sent them. */
	opening: Record<string, { message: string; code?: string; data?: unknown } | undefined>;
	models: ModelInfo[];
	defaultModel: string | null;
	/** The reasoning level a new thread starts with (settings.json: per model, else the default, else medium). */
	thinkingDefaults: { level?: ThinkingLevel; perModel: Record<string, ThinkingLevel> };
	toasts: Toast[];
	/** Back/forward over views (the title bar arrows). */
	history: { stack: View[]; index: number };
	accounts: Accounts | undefined;
	logins: Record<string, LoginState>;
	sidebarOpen: boolean;
	paletteOpen: boolean;
	/** The open thread's find bar (View › Find, Ctrl+F). */
	finding: boolean;
	/** The theme the window shows: the preference, or the system's when it is "system". */
	resolvedTheme: ThemeName;
	/**
	 * The right region (desktop-shell.md section 9.6): open, its width in px, a diff scope asked for, and whether it
	 * fills the thread view in place of the chat (Codex's full screen).
	 */
	panel: { open: boolean; width: number; scope?: DiffScope; full?: boolean };
	/** Review comments drafted on the diff, per thread; they go with the next message (Codex's "1 comment"). */
	comments: Record<string, DiffComment[]>;
	/** Bumped by turn/diff/updated, so an open Changes pane reloads. */
	diffVersion: Record<string, number>;
	/** The latest output of a worktree's setup script, per thread. */
	progress: Record<string, string>;
}

let state: State = {
	server: { state: "starting" },
	undoneTurns: {},
	desktop: undefined,
	threads: [],
	view: { kind: "new" },
	held: {},
	opening: {},
	models: [],
	defaultModel: null,
	thinkingDefaults: { perModel: {} },
	toasts: [],
	history: { stack: [{ kind: "new" }], index: 0 },
	accounts: undefined,
	logins: {},
	sidebarOpen: true,
	paletteOpen: false,
	finding: false,
	resolvedTheme: "dark",
	panel: { open: false, width: 0 },
	comments: {},
	diffVersion: {},
	progress: {},
};
const listeners = new Set<() => void>();

function set(update: (draft: State) => State): void {
	state = update(state);
	for (const listener of listeners) listener();
}

export function useStore<T>(select: (s: State) => T): T {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => select(state),
	);
}

export const getState = (): State => state;

const NO_PROJECTS: DesktopState["projects"] = [];
/** Selectors must return stable values: a fresh `[]` per read re-renders forever. */
export const selectProjects = (s: State) => s.desktop?.projects ?? NO_PROJECTS;
export const selectPreferences = (s: State): Preferences => s.desktop?.preferences ?? DEFAULT_PREFERENCES;

/** Codex's sidebar options (Organize sidebar, Sort chats by), the defaults for what is unset. A new object per read. */
export const sidebarOptionsOf = (s: State): SidebarOptions => ({
	organize: s.desktop?.sidebar.organize ?? DEFAULT_SIDEBAR_OPTIONS.organize,
	sort: s.desktop?.sidebar.sort ?? DEFAULT_SIDEBAR_OPTIONS.sort,
});

/** The threads Alt+1-9 reach, as the sidebar lists them (sidebar-model.ts). Call it outside render: a new array each time. */
export const threadSlotsOf = (s: State): ThreadSummary[] =>
	threadSlots(
		sidebarModel(s.threads, selectProjects(s), s.desktop?.pinnedThreads ?? [], "", samePath, sidebarOptionsOf(s)),
		s.desktop?.sidebar.collapsedSections ?? [],
	);

const openId = () => (state.view.kind === "thread" ? state.view.id : undefined);
const openIf = (thread: ThreadSummary | undefined) => thread && void openThread(thread.id);

/** Codex's thread navigation: the Nth sidebar slot, the Nth most recent, the next or previous sidebar item. */
export const openSlot = (slot: number) => openIf(threadSlotsOf(state)[slot]);
export const openRecent = (slot: number) => openIf(recentThreads(state.threads, slot + 1)[slot]);
export const openNextInSidebar = (delta: 1 | -1) => openIf(stepThread(threadSlotsOf(state), openId(), delta));
/** Codex's "Next chat needing attention": waiting on the user, failed or unread. */
export const openNextNeedingAttention = () =>
	openIf(nextNeedingAttention(threadSlotsOf(state), state.threads, selectUnread(state), openId()));

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

/** Show a view and record it for back/forward. */
export function navigate(view: View): void {
	set((s) => {
		if (sameView(s.view, view)) return s;
		const stack = [...s.history.stack.slice(0, s.history.index + 1), view].slice(-50);
		return { ...s, view, history: { stack, index: stack.length - 1 } };
	});
}

export function goBack(delta: -1 | 1): void {
	const { stack, index } = state.history;
	const next = stack[index + delta];
	if (!next) return;
	set((s) => ({ ...s, view: next, history: { stack, index: index + delta } }));
	if (next.kind === "thread" && !state.held[next.id]) void resumeThread(next.id);
}

/** Show or hide the sidebar; the choice is remembered across launches (desktop state, `sidebar.collapsed`). */
export function setSidebarOpen(open: boolean): void {
	set((s) => ({ ...s, sidebarOpen: open }));
	updateDesktop((d) => ({ ...d, sidebar: { ...d.sidebar, collapsed: !open } }));
}

export function setSidebarWidth(width: number): void {
	const clamped = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
	updateDesktop((d) => ({ ...d, sidebar: { ...d.sidebar, width: clamped } }));
}

export function setSidebarOption<K extends keyof SidebarOptions>(key: K, value: SidebarOptions[K]): void {
	updateDesktop((d) => ({ ...d, sidebar: { ...d.sidebar, [key]: value } }));
}

/** Fold or unfold a sidebar section ("projects", "recents", ...), remembered across launches. */
export function toggleSection(section: string): void {
	updateDesktop((d) => {
		const folded = d.sidebar.collapsedSections ?? [];
		const next = folded.includes(section) ? folded.filter((s) => s !== section) : [...folded, section];
		return { ...d, sidebar: { ...d.sidebar, collapsedSections: next } };
	});
}

/** Fold or unfold a project's threads in the sidebar, remembered across launches. */
export function toggleProject(path: string): void {
	updateDesktop((d) => ({
		...d,
		projects: d.projects.map((p) => (p.path === path ? { ...p, collapsed: !p.collapsed } : p)),
	}));
}

/** Take a project out of the sidebar; its folder and threads stay where they are. */
export function removeProject(path: string): void {
	updateDesktop((d) => ({ ...d, projects: d.projects.filter((p) => p.path !== path) }));
}

export function setPaletteOpen(open: boolean): void {
	set((s) => ({ ...s, paletteOpen: open }));
}

export function setFinding(finding: boolean): void {
	set((s) => ({ ...s, finding }));
}

export function setResolvedTheme(resolvedTheme: ThemeName): void {
	if (state.resolvedTheme !== resolvedTheme) set((s) => ({ ...s, resolvedTheme }));
}

/**
 * Change a theme's customization (Settings › Appearance): merge `patch`, or with `replace` start over from it; an
 * undefined field, or no patch at all, goes back to the built-in value.
 */
export function customize(theme: ThemeName, patch: Customization | undefined, replace = false): void {
	const all = selectPreferences(state).appearance ?? {};
	const merged = replace ? { ...patch } : { ...all[theme], ...patch };
	// 0 is a value (the Contrast slider's low end); undefined, false and "" go back to the built-in value.
	const next = patch
		? Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== false && v !== ""))
		: {};
	setPreference("appearance", { ...all, [theme]: next });
}

function updateThread(id: string, fn: (view: ThreadView) => ThreadView): void {
	set((s) => (s.held[id] ? { ...s, held: { ...s.held, [id]: fn(s.held[id]!) } } : s));
}

let toastId = 0;
/** A note over the window: an error, a confirmation ("Committed …"), or anything else. */
export interface Toast {
	id: number;
	text: string;
	kind: "error" | "success" | "info";
}

export function toast(text: string, kind: Toast["kind"] = "info"): void {
	const id = ++toastId;
	set((s) => ({ ...s, toasts: [...s.toasts, { id, text, kind }] }));
	setTimeout(() => dismissToast(id), 5000);
}

export function dismissToast(id: number): void {
	set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// --- payloads ---------------------------------------------------------------------------------

async function readPayload(ref: PayloadRef): Promise<unknown> {
	const bytes = new Uint8Array(ref.byteLength);
	let offset = 0;
	for (;;) {
		const chunk = await client.request("payload/read", { id: ref.id, offset });
		const binary = atob(chunk.data);
		// Typed-array writes past the end are dropped silently; JSON.parse would then fail with no cause.
		if (offset + binary.length > ref.byteLength) throw new Error("payload chunk exceeds its declared length");
		for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i);
		offset += binary.length;
		if (chunk.eof) break;
		if (binary.length === 0 || chunk.nextOffset !== offset) throw new Error("payload chunk made no progress");
	}
	return JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset)));
}

const resolveTurn = async (wire: WireTurn): Promise<Turn> =>
	"payload" in wire ? ((await readPayload(wire.payload)) as Turn) : wire;
const resolveItem = async (wire: WireItem): Promise<Item> =>
	wire.type === "itemReference" ? ((await readPayload(wire.payload)) as Item) : wire;

function withTurn(view: ThreadView, turnId: string, fn: (turn: ViewTurn) => ViewTurn): ThreadView {
	const index = view.turns.findIndex((t) => t.id === turnId);
	if (index === -1) return view;
	const turns = [...view.turns];
	turns[index] = fn(turns[index]!);
	return { ...view, turns };
}

// --- notifications ----------------------------------------------------------------------------

function upsertSummary(thread: Thread): void {
	const { id, cwd, projectCwd, name, status, archived, createdAt, forkedFromId, updatedAt } = thread;
	const summary: ThreadSummary = {
		id,
		cwd,
		projectCwd,
		name,
		status,
		archived,
		createdAt,
		...(forkedFromId !== undefined ? { forkedFromId } : {}),
		updatedAt,
		workspaceMode: thread.workspace.mode,
	};
	set((s) => {
		const threads = s.threads.filter((t) => t.id !== summary.id);
		return { ...s, threads: [summary, ...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
	});
}

function patchSummary(id: string, patch: Partial<ThreadSummary>): void {
	set((s) => ({ ...s, threads: s.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

async function applyNotification(n: AnyNotification): Promise<void> {
	switch (n.method) {
		case "thread/started":
			upsertSummary(n.params.thread);
			return;
		case "thread/status/changed":
			patchSummary(n.params.threadId, { status: n.params.status });
			updateThread(n.params.threadId, (v) => ({ ...v, thread: { ...v.thread, status: n.params.status } }));
			return;
		case "thread/name/updated":
			patchSummary(n.params.threadId, { name: n.params.name });
			updateThread(n.params.threadId, (v) => ({ ...v, thread: { ...v.thread, name: n.params.name } }));
			return;
		case "thread/settings/updated":
			updateThread(n.params.thread.id, (v) => ({ ...v, thread: n.params.thread }));
			return;
		case "thread/archived":
			if (n.params.archived) set((s) => ({ ...s, threads: s.threads.filter((t) => t.id !== n.params.threadId) }));
			else void refreshThreads();
			return;
		case "thread/deleted":
			set((s) => ({ ...s, threads: s.threads.filter((t) => t.id !== n.params.threadId) }));
			if (openId() === n.params.threadId) showNew();
			return;
		case "thread/turn/completed": {
			const { threadId } = n.params.turn;
			patchSummary(threadId, { updatedAt: new Date().toISOString() });
			// Every window hears this; one acts for all, so there is one notification and one unread mark.
			const { turn } = n.params;
			void client
				.host("host/window/role", {})
				.then(({ primary, heldElsewhere }) => {
					if (!primary) return;
					// An outcome the user did not see marks the thread unread until they open it.
					const shown = (state.view.kind === "thread" && state.view.id === threadId) || heldElsewhere.includes(threadId);
					if (!shown) setUnread(threadId, true);
					notifyTurn(turn);
				})
				.catch(() => {});
			return;
		}
		case "turn/diff/updated": {
			const { threadId, turnId, files } = n.params;
			updateThread(threadId, (v) => withTurn(v, turnId, (t) => ({ ...t, files })));
			refreshDiff(threadId);
			return;
		}
		case "thread/workspace/progress": {
			const { threadId, output } = n.params;
			set((s) => ({
				...s,
				progress: { ...s.progress, [threadId]: ((s.progress[threadId] ?? "") + output).slice(-4096) },
			}));
			return;
		}
		case "thread/replaced": {
			const { oldThreadId, thread } = n.params;
			if (state.view.kind === "thread" && state.view.id === oldThreadId) navigate({ kind: "thread", id: thread.id });
			// A handoff replaces a thread by itself with a new cwd and workspace. Only windows subscribed to the thread
			// get this; the others re-list their sidebar when focused.
			upsertSummary(thread);
			// The server unloaded the old thread; holding it would resume it again after a restart. A handoff keeps the
			// id: its view stays, so the resume keeps its pending messages and approvals.
			if (oldThreadId !== thread.id)
				set((s) => {
					const { [oldThreadId]: _old, ...held } = s.held;
					return { ...s, held };
				});
			// Not awaited: resumeThread waits for the event chain this handler runs on.
			void resumeThread(thread.id);
			return;
		}
		case "turn/started": {
			const { turn } = n.params;
			updateThread(turn.threadId, (v) => ({
				...v,
				retry: undefined,
				turns: v.turns.some((t) => t.id === turn.id) ? v.turns : [...v.turns, toView(turn)],
			}));
			return;
		}
		case "turn/completed": {
			const { turn } = n.params;
			updateThread(turn.threadId, (v) => ({
				...withTurn(v, turn.id, (t) => ({ ...t, ...turn, items: t.items })),
				retry: undefined,
				// A start whose turn ended without echoing its message created none (section 7.2).
				pending: v.pending.filter((p) => p.failed),
			}));
			return;
		}
		case "turn/retry":
			updateThread(n.params.threadId, (v) => ({ ...v, retry: { ...n.params, at: Date.now() } }));
			return;
		case "thread/tokenUsage/updated":
			updateThread(n.params.threadId, (v) => ({ ...v, usage: n.params.usage }));
			return;
		case "turn/queue/updated":
			updateThread(n.params.threadId, (v) => ({
				...v,
				queue: { steering: n.params.steering, followUp: n.params.followUp },
			}));
			return;
		case "item/started":
		case "item/completed": {
			const { threadId, turnId, index } = n.params;
			const item: ViewItem = { ...(await resolveItem(n.params.item)), ...(index === undefined ? {} : { index }) };
			if (item.type === "userMessage" && !state.threads.find((t) => t.id === threadId)?.name) {
				// The server names an unnamed thread after its first message on read-back; match it live.
				const name = item.text.split("\n", 1)[0]!.trim().slice(0, 200);
				patchSummary(threadId, { name });
				updateThread(threadId, (v) => (v.thread.name ? v : { ...v, thread: { ...v.thread, name } }));
			}
			updateThread(threadId, (v) => {
				const next = withTurn(v, turnId, (t) => ({ ...t, items: placeItem(t.items, item) }));
				if (item.type !== "userMessage" || !item.clientMessageId) return next;
				queuedComments.delete(item.clientMessageId);
				return { ...next, pending: next.pending.filter((p) => p.clientMessageId !== item.clientMessageId) };
			});
			return;
		}
		case "item/removed":
			updateThread(n.params.threadId, (v) =>
				withTurn(v, n.params.turnId, (t) => ({ ...t, items: t.items.filter((i) => i.id !== n.params.itemId) })),
			);
			return;
		case "item/agentMessage/delta":
		case "item/reasoning/delta": {
			const { threadId, turnId, itemId, delta } = n.params;
			updateThread(threadId, (v) =>
				withTurn(v, turnId, (t) => ({
					...t,
					items: t.items.map((i) =>
						i.id === itemId && (i.type === "agentMessage" || i.type === "reasoning")
							? { ...i, text: i.text + delta }
							: i,
					),
				})),
			);
			return;
		}
		case "item/toolCall/outputDelta": {
			const { threadId, turnId, itemId } = n.params;
			const output = Array.isArray(n.params.output)
				? n.params.output
				: ((await readPayload(n.params.output)) as typeof n.params.output);
			if (!Array.isArray(output)) return;
			updateThread(threadId, (v) =>
				withTurn(v, turnId, (t) => ({
					...t,
					items: t.items.map((i) => (i.id === itemId && i.type === "toolCall" ? { ...i, output } : i)),
				})),
			);
			return;
		}
		case "serverRequest/cancelled":
			set((s) => {
				const held = Object.fromEntries(
					Object.entries(s.held).map(([id, v]) => [
						id,
						{ ...v, requests: v.requests.filter((r) => r.id !== n.params.id) },
					]),
				);
				return { ...s, held };
			});
			return;
		case "ui/notify":
			toast(n.params.message, n.params.level === "error" ? "error" : "info");
			return;
		case "warning":
		case "error": {
			toast(n.params.message, n.method === "error" ? "error" : "info");
			const failed = "clientMessageId" in n.params ? n.params.clientMessageId : undefined;
			const kept = failed ? queuedComments.get(failed) : undefined;
			if (failed && kept) {
				queuedComments.delete(failed);
				set((s) => ({
					...s,
					comments: { ...s.comments, [kept.threadId]: [...(s.comments[kept.threadId] ?? []), ...kept.comments] },
				}));
			}
			return;
		}
		case "account/login/updated":
			set((s) => ({ ...s, logins: { ...s.logins, [n.params.loginId]: n.params } }));
			if (n.params.status === "complete") void Promise.all([refreshAccounts(), refreshModels()]);
			return;
		case "account/updated":
			void Promise.all([refreshAccounts(), refreshModels()]);
			return;
		default:
			return;
	}
}

function applyServerRequest(request: AnyServerRequest): void {
	updateThread(request.params.threadId, (v) => ({ ...v, requests: [...v.requests, request] }));
}

/**
 * Live events for threads whose thread/resume answered but whose snapshot is not installed yet; they
 * are newer than the snapshot and replay after it (app-server.md, thread/resume).
 */
const resuming = new Map<string, (() => Promise<void> | void)[]>();

function threadOfEvent(params: unknown): string | undefined {
	const p = params as { threadId?: unknown; turn?: { threadId?: unknown }; thread?: { id?: unknown } } | undefined;
	const id = p?.threadId ?? p?.turn?.threadId ?? p?.thread?.id;
	return typeof id === "string" ? id : undefined;
}

// Events apply in arrival order even when one awaits a payload.
let chain = Promise.resolve();
function enqueue(params: unknown, apply: () => Promise<void> | void): void {
	const buffer = resuming.get(threadOfEvent(params) ?? "");
	if (buffer) buffer.push(apply);
	else chain = chain.then(apply).catch((error: unknown) => console.error(error));
}
client.onNotification((n) => enqueue(n.params, () => applyNotification(n)));
client.onServerRequest((r) => enqueue(r.params, () => applyServerRequest(r)));
/** A link main handed over before the server was ready; shown once it is. */
let pendingRoute: string | undefined;

client.onHostEvent((event) => {
	if (event.event === "navigate") {
		if (state.server.state === "ready" && state.desktop) showLink(event.route);
		else pendingRoute = event.route;
		return;
	}
	if (event.event !== "server/state") return;
	const wasReady = state.server.state === "ready";
	set((s) => ({ ...s, server: { state: event.state, message: event.message } }));
	if (event.state === "ready" && !wasReady) void connected();
});

/** Show what a `knightcode://` link names (routes.ts); others are ignored. */
function showLink(route: string): void {
	const view = viewOfLink(route);
	if (view?.kind === "thread") void openThread(view.id);
	else if (view) navigate(view);
}
// Threads started elsewhere (the terminal, another window) send no notification here; coming back to the
// window is when they matter.
window.addEventListener("focus", () => {
	if (state.server.state === "ready") void refreshThreads().catch(() => {});
});

// --- actions ----------------------------------------------------------------------------------

async function connected(): Promise<void> {
	try {
		const first = !state.desktop;
		const desktop = state.desktop ?? (await client.host("host/state/read", {}));
		set((s) => ({ ...s, desktop, ...(first ? { sidebarOpen: !desktop.sidebar.collapsed } : {}) }));
		await Promise.all([refreshThreads(), refreshModels(), refreshAccounts()]);
		// After a restart the new server has no subscriptions: resume what this window shows.
		for (const id of Object.keys(state.held)) void resumeThread(id);
		if (pendingRoute) showLink(pendingRoute);
		pendingRoute = undefined;
	} catch (error) {
		toast(errorText(error), "error");
	}
}

export async function refreshThreads(): Promise<void> {
	const threads: ThreadSummary[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.request("thread/list", cursor ? { cursor } : {});
		threads.push(...page.threads);
		cursor = page.nextCursor;
	} while (cursor && threads.length < 500);
	set((s) => ({ ...s, threads }));
}

export async function refreshModels(): Promise<void> {
	const [{ models, default: defaultModel }, config] = await Promise.all([
		client.request("model/list", {}),
		client.request("config/read", {}).catch(() => undefined),
	]);
	const settings = (config?.settings ?? {}) as {
		defaultThinkingLevel?: ThinkingLevel;
		modelThinkingLevels?: Record<string, ThinkingLevel>;
	};
	const thinkingDefaults = {
		...(settings.defaultThinkingLevel ? { level: settings.defaultThinkingLevel } : {}),
		perModel: settings.modelThinkingLevels ?? {},
	};
	set((s) => ({ ...s, models, defaultModel, thinkingDefaults }));
}

/** The level a new thread on  starts with, as the server resolves it (model-resolver.ts). */
export const startingThinking = (s: State, model: { provider: string; id: string }): ThinkingLevel =>
	s.thinkingDefaults.perModel[`${model.provider}/${model.id}`] ?? s.thinkingDefaults.level ?? "medium";

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function updateDesktop(fn: (d: DesktopState) => DesktopState): void {
	if (!state.desktop) return;
	const desktop = fn(state.desktop);
	set((s) => ({ ...s, desktop }));
	clearTimeout(saveTimer);
	saveTimer = setTimeout(
		() => void client.host("host/state/write", { state: desktop }).catch((e: unknown) => toast(errorText(e), "error")),
		500,
	);
}

export function showNew(cwd?: string): void {
	navigate(cwd ? { kind: "new", cwd } : { kind: "new" });
}

export async function addProject(): Promise<string | undefined> {
	const { path } = await client.host("host/dialog/openFolder", {});
	if (!path) return undefined;
	updateDesktop((d) =>
		d.projects.some((p) => p.path === path) ? d : { ...d, projects: [...d.projects, { path, collapsed: false }] },
	);
	return path;
}

export async function openThread(id: string): Promise<void> {
	navigate({ kind: "thread", id });
	setUnread(id, false);
	await resumeThread(id);
}

/** Subscribe to a thread and load its history without changing the view. */
async function resumeThread(id: string): Promise<void> {
	set((s) => ({ ...s, opening: { ...s.opening, [id]: undefined } }));
	const buffer: (() => Promise<void> | void)[] = [];
	// Events arriving during the replay join the buffer, so order holds until it drains.
	const drain = async () => {
		for (let next = buffer.shift(); next; next = buffer.shift()) {
			try {
				await next();
			} catch (replayError) {
				console.error(replayError);
			}
		}
	};
	try {
		const result = await client.request("thread/resume", { threadId: id });
		// Each port message is its own task, so nothing newer than the response has arrived yet.
		resuming.set(id, buffer);
		// Older events still queued are in the snapshot; let them land first so it overwrites them.
		await chain;
		const turns = await Promise.all(result.turns.map(resolveTurn));
		const running = result.runningTurn ? await resolveTurn(result.runningTurn) : undefined;
		if (running && !turns.some((t) => t.id === running.id)) turns.push(running);
		set((s) => ({
			...s,
			held: {
				...s.held,
				[id]: {
					thread: result.thread,
					turns: turns.map(toView),
					queue: result.queue,
					usage: result.usage,
					requests: s.held[id]?.requests ?? [],
					pending: s.held[id]?.pending ?? [],
					...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
				},
			},
		}));
		for (const warning of result.warnings) toast(warning.message);
		await drain();
	} catch (error) {
		const code = error instanceof RequestError ? error.code : undefined;
		const data = error instanceof RequestError ? error.data : undefined;
		const message =
			code === "threadLockedElsewhere" ? "This thread is open in another KnightCode process." : errorText(error);
		set((s) => ({
			...s,
			opening: { ...s.opening, [id]: { message, ...(code ? { code } : {}), ...(data ? { data } : {}) } },
		}));
		// No snapshot replaced the held view, which saw every event up to the buffer: apply the buffer so it
		// stays current. With no held view the events have nothing to update.
		await drain();
	} finally {
		if (resuming.get(id) === buffer) resuming.delete(id);
	}
}

export async function startThread(
	cwd: string,
	text: string,
	options: {
		model?: { provider: string; id: string };
		thinkingLevel?: ThinkingLevel;
		approvalMode?: ApprovalMode;
		workspace?: WorkspaceRequest;
	},
	images?: ImageInput[],
): Promise<void> {
	const { thread, warnings } = await client.request("thread/start", { cwd, ...options });
	for (const warning of warnings) toast(warning.message);
	navigate({ kind: "thread", id: thread.id });
	set((s) => ({
		...s,
		held: {
			...s.held,
			[thread.id]: { thread, turns: [], queue: { steering: [], followUp: [] }, requests: [], pending: [] },
		},
	}));
	await send(thread.id, text, images);
}

const newClientId = () => crypto.randomUUID();

/** Review comments of queued inputs, by the input's clientMessageId, until it starts or fails to. */
const queuedComments = new Map<string, { threadId: string; queueId?: string; comments: DiffComment[] }>();

/** Give queued inputs' comments back as drafts: those of one removed input, or all of a thread whose queue was dropped. */
function restoreQueuedComments(threadId: string, queueId?: string): void {
	for (const [id, kept] of queuedComments) {
		if (kept.threadId !== threadId || (queueId !== undefined && kept.queueId !== queueId)) continue;
		queuedComments.delete(id);
		set((s) => ({ ...s, comments: { ...s.comments, [threadId]: [...(s.comments[threadId] ?? []), ...kept.comments] } }));
	}
}

/** The composer is already cleared: keep a failed queue or steer as a failed bubble with Retry, not a toast. */
const failedSend = (threadId: string, text: string, images: ImageInput[] | undefined) => (error: unknown) =>
	updateThread(threadId, (v) => ({
		...v,
		pending: [...v.pending, { clientMessageId: newClientId(), text, images, failed: errorText(error) }],
	}));

/** Start a turn on an idle thread, queue on a running one (section 9.4). Drafted review comments go along. */
export async function send(threadId: string, text: string, images?: ImageInput[]): Promise<void> {
	const view = state.held[threadId];
	if (!view) return;
	const comments = state.comments[threadId] ?? [];
	const extra = comments.length ? { comments } : {};
	// Only the drafts that went with this input; any added while it was in flight stay.
	const clearComments = () =>
		set((s) => ({
			...s,
			comments: { ...s.comments, [threadId]: (s.comments[threadId] ?? []).filter((c) => !comments.includes(c)) },
		}));
	const running = view.turns.some((t) => t.status === "inProgress");
	if (running) {
		// The comments are kept by the input's id until it starts: one that cannot start gives them back as drafts.
		const queuedId = newClientId();
		// Before the request: the input can start (and drop its entry) before the answer arrives.
		if (comments.length) queuedComments.set(queuedId, { threadId, comments });
		await client
			.request("turn/queue/add", {
				threadId,
				text,
				clientMessageId: queuedId,
				...(images?.length ? { images } : {}),
				...extra,
			})
			.then(
				({ queueId }) => {
					const kept = queuedComments.get(queuedId);
					if (kept) kept.queueId = queueId;
					clearComments();
				},
				(error: unknown) => {
					queuedComments.delete(queuedId);
					failedSend(threadId, text, images)(error);
				},
			);
		return;
	}
	const clientMessageId = newClientId();
	updateThread(threadId, (v) => ({ ...v, pending: [...v.pending, { clientMessageId, text, images }] }));
	try {
		const result = await client.request("turn/start", {
			threadId,
			text,
			clientMessageId,
			...(images?.length ? { images } : {}),
			...extra,
		});
		// A handled or cancelled start made no user message, so the server dropped the comments: keep the drafts.
		if (result.status === "started") clearComments();
		else
			updateThread(threadId, (v) => ({
				...v,
				pending: v.pending.filter((p) => p.clientMessageId !== clientMessageId),
			}));
	} catch (error) {
		updateThread(threadId, (v) => ({
			...v,
			pending: v.pending.map((p) => (p.clientMessageId === clientMessageId ? { ...p, failed: errorText(error) } : p)),
		}));
	}
}

export async function steer(threadId: string, text: string, images?: ImageInput[]): Promise<void> {
	const turn = state.held[threadId]?.turns.findLast((t) => t.status === "inProgress");
	if (!turn) return send(threadId, text, images);
	await client
		.request("turn/steer", { threadId, expectedTurnId: turn.id, text, ...(images?.length ? { images } : {}) })
		.catch(failedSend(threadId, text, images));
}

export async function interrupt(threadId: string): Promise<void> {
	const turn = state.held[threadId]?.turns.findLast((t) => t.status === "inProgress");
	await client.request("turn/interrupt", turn ? { threadId, turnId: turn.id } : { threadId }).then(
		// The server drops the queue on a stop: its inputs' comments come back as drafts.
		() => restoreQueuedComments(threadId),
		(e: unknown) => toast(errorText(e), "error"),
	);
}

/** False when the input already started its own turn (or the request failed): it is no longer the client's to resend. */
export async function removeQueued(threadId: string, queueId: string): Promise<boolean> {
	try {
		const { removed } = await client.request("turn/queue/remove", { threadId, queueId });
		if (removed) restoreQueuedComments(threadId, queueId);
		return removed;
	} catch (e) {
		toast(errorText(e), "error");
		return false;
	}
}

export function dismissPending(threadId: string, clientMessageId: string): void {
	updateThread(threadId, (v) => ({ ...v, pending: v.pending.filter((p) => p.clientMessageId !== clientMessageId) }));
}

export function answerApproval(threadId: string, approval: Approval, result: ApprovalResult): void {
	client.respond<"item/toolCall/requestApproval">(approval.id, result);
	updateThread(threadId, (v) => ({ ...v, requests: v.requests.filter((r) => r.id !== approval.id) }));
}

/** Answer a dialog: `value` for a select, input or editor, `confirmed` for a confirm, nothing to cancel. */
export function answerDialog(threadId: string, dialog: Dialog, result: ServerRequestResult<"ui/dialog">): void {
	client.respond<"ui/dialog">(dialog.id, result);
	updateThread(threadId, (v) => ({ ...v, requests: v.requests.filter((r) => r.id !== dialog.id) }));
}

/** Answer ask_user's questions: each by its id, skipped ones left out; `{}` dismisses them and stops the turn. */
export function answerQuestions(
	threadId: string,
	request: UserInput,
	result: ServerRequestResult<"item/toolCall/requestUserInput">,
): void {
	client.respond<"item/toolCall/requestUserInput">(request.id, result);
	updateThread(threadId, (v) => ({ ...v, requests: v.requests.filter((r) => r.id !== request.id) }));
}

export async function updateSettings(
	threadId: string,
	settings: { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel; approvalMode?: ApprovalMode },
): Promise<void> {
	try {
		const { thread } = await client.request("thread/settings/update", { threadId, ...settings });
		updateThread(threadId, (v) => ({ ...v, thread }));
	} catch (error) {
		toast(errorText(error), "error");
	}
}

export async function archive(threadId: string): Promise<void> {
	try {
		await stopAndArchive(threadId);
	} catch (e) {
		// Refused: the thread stays open where the user is.
		toast(errorText(e), "error");
		return;
	}
	if (state.view.kind === "thread" && state.view.id === threadId) showNew();
}

/** Archive a thread, stopping it first if it runs (the server archives only idle threads). */
async function stopAndArchive(threadId: string): Promise<void> {
	if (state.threads.find((t) => t.id === threadId)?.status.type === "active") {
		await client.request("turn/interrupt", { threadId });
		// The interrupt answers before the turn ends, and the server archives only idle threads: wait (10 s at most).
		const deadline = Date.now() + 10_000;
		while (state.threads.find((t) => t.id === threadId)?.status.type === "active") {
			if (Date.now() > deadline) throw new Error("the turn did not stop");
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	await client.request("thread/archive", { threadId });
}

/**
 * Archive several threads (Codex's "Archive chats" on a project, and a sidebar selection), stopping any that run
 * first, then say how it went: "Archived 3 threads", or how many failed. `where` names the project, if one.
 */
export async function archiveThreads(ids: string[], where?: string): Promise<void> {
	const results = await Promise.allSettled(ids.map(stopAndArchive));
	const failed = results.filter((r) => r.status === "rejected").length;
	const archived = ids.length - failed;
	const threads = (n: number) => `${n} ${n === 1 ? "thread" : "threads"}`;
	const place = where ? ` in ${where}` : "";
	if (!failed) toast(`Archived ${threads(archived)}`, "success");
	else if (archived) toast(`Archived ${threads(archived)}${place}; ${failed} failed`, "error");
	else toast(`Failed to archive the threads${place}`, "error");
	if (ids.includes(openId() ?? "")) showNew();
}

/** Codex's "Open in new window": the thread in a window of its own. */
export function openInNewWindow(threadId: string): void {
	void client.host("host/window/open", { threadId }).catch((e: unknown) => toast(errorText(e), "error"));
}

/** False when the write failed (its error is toasted). */
export async function copyText(text: string): Promise<boolean> {
	return client.host("host/clipboard/writeText", { text }).then(
		() => true,
		(e: unknown) => {
			toast(errorText(e), "error");
			return false;
		},
	);
}

/** Codex's "Copy last code block": the last fenced block in the thread's replies (lastCodeBlock in format.ts). */
export function copyLastCodeBlock(threadId: string): void {
	const replies = (state.held[threadId]?.turns ?? []).flatMap((t) => t.items).filter((i) => i.type === "agentMessage");
	const code = lastCodeBlock(replies.map((i) => i.text));
	if (code === undefined) return toast("No code block in this thread");
	void copyText(code).then((ok) => ok && toast("Copied the code block", "success"));
}

export async function rename(threadId: string, name: string): Promise<void> {
	await client.request("thread/name/set", { threadId, name }).catch((e: unknown) => toast(errorText(e), "error"));
}

export async function compact(threadId: string): Promise<void> {
	await client.request("thread/compact", { threadId }).catch((e: unknown) => toast(errorText(e), "error"));
}

// --- history, accounts, archive, pickers -----------------------------------------------------

/** Older turns, prepended above what is shown (section 9.3). */
export async function loadEarlier(threadId: string): Promise<void> {
	const cursor = state.held[threadId]?.nextCursor;
	if (!cursor) return;
	try {
		const page = await client.request("thread/read", { threadId, cursor });
		const older = (await Promise.all(page.turns.map(resolveTurn))).map(toView);
		updateThread(threadId, (v) => {
			const known = new Set(v.turns.map((t) => t.id));
			const { nextCursor: _, ...rest } = v;
			return {
				...rest,
				turns: [...older.filter((t) => !known.has(t.id)), ...v.turns],
				...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
			};
		});
	} catch (error) {
		toast(errorText(error), "error");
	}
}

export async function refreshAccounts(): Promise<void> {
	try {
		const accounts = await client.request("account/list", {});
		set((s) => ({ ...s, accounts }));
	} catch (error) {
		toast(errorText(error), "error");
	}
}

export async function startLogin(provider: string, type: "oauth" | "api_key"): Promise<string | undefined> {
	try {
		const { loginId } = await client.request("account/login/start", { provider, type });
		return loginId;
	} catch (error) {
		toast(errorText(error), "error");
		return undefined;
	}
}

export async function answerLogin(loginId: string, value: string): Promise<void> {
	await client.request("account/login/answer", { loginId, value }).catch((e: unknown) => toast(errorText(e), "error"));
}

export async function cancelLogin(loginId: string): Promise<void> {
	await client.request("account/login/cancel", { loginId }).catch(() => {});
	set((s) => {
		const { [loginId]: _, ...logins } = s.logins;
		return { ...s, logins };
	});
}

export async function logout(provider: string): Promise<void> {
	await client.request("account/logout", { provider }).catch((e: unknown) => toast(errorText(e), "error"));
	await Promise.all([refreshAccounts(), refreshModels()]);
}

/** The terminal and the desktop share one default model, in settings.json. */
export async function setDefaultModel(model: ModelInfo): Promise<void> {
	try {
		await client.request("config/write", { scope: "global", key: "defaultProvider", value: model.provider });
		await client.request("config/write", { scope: "global", key: "defaultModel", value: model.id });
		await refreshModels();
	} catch (error) {
		toast(errorText(error), "error");
	}
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
	updateDesktop((d) => ({ ...d, preferences: { ...(d.preferences ?? DEFAULT_PREFERENCES), [key]: value } }));
}

/** Rebind a shortcut (Settings › Keyboard shortcuts); undefined, or its defaults, drop the rebinding. */
export function setKeybinding(id: KeybindingId, keys: string[] | undefined): void {
	const next = { ...(selectPreferences(state).keybindings ?? {}) };
	const defaults: readonly string[] = DESKTOP_KEYBINDINGS[id].defaultKeys;
	if (!keys || (keys.length === defaults.length && keys.every((k, i) => k === defaults[i]))) delete next[id];
	else next[id] = keys;
	setPreference("keybindings", next);
}

export async function listArchived(): Promise<ThreadSummary[]> {
	const threads: ThreadSummary[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.request("thread/list", cursor ? { archived: true, cursor } : { archived: true });
		threads.push(...page.threads);
		cursor = page.nextCursor;
	} while (cursor && threads.length < 500);
	return threads;
}

export async function unarchive(threadId: string): Promise<void> {
	await client.request("thread/unarchive", { threadId }).catch((e: unknown) => toast(errorText(e), "error"));
}

/** Delete a thread for good. The server deletes only archived threads, so a live one (in the sidebar) is archived first. */
export async function deleteThread(threadId: string): Promise<void> {
	try {
		if (state.threads.some((t) => t.id === threadId)) await stopAndArchive(threadId);
		await client.request("thread/delete", { threadId });
	} catch (error) {
		toast(errorText(error), "error");
	}
}

/** A copy of the thread, up to `atItemId` when given (Codex's "Branch in new chat"), in a new worktree on request. */
export async function fork(threadId: string, atItemId?: string, inWorktree = false): Promise<void> {
	try {
		const { thread } = await client.request("thread/fork", {
			threadId,
			...(atItemId ? { atItemId } : {}),
			...(inWorktree ? { workspace: { mode: "worktree" as const } } : {}),
		});
		upsertSummary(thread);
		await openThread(thread.id);
	} catch (error) {
		toast(errorText(error), "error");
	}
}

/** A thread's commands, or a project's before it has a thread. */
export async function listCommands(
	target: { threadId: string } | { cwd: string },
): Promise<{ name: string; description: string }[]> {
	try {
		return (await client.request("command/list", target)).commands;
	} catch {
		return [];
	}
}

/** One searchId per composer, so each keystroke supersedes the last search (section 9.4). */
export function searchFiles(cwd: string, query: string, searchId: string) {
	return client.request("file/search", { cwd, query, searchId, limit: 30 });
}

/**
 * Codex's "Turn completion notifications" (Settings › General): an OS notification when a turn ends, always or only
 * while the window is unfocused; clicking it brings the window forward on the thread.
 */
function notifyTurn(turn: TurnSummary): void {
	const when = selectPreferences(state).turnNotifications ?? "unfocused";
	if (when === "never" || turn.status === "inProgress" || (when === "unfocused" && document.hasFocus())) return;
	const name = state.threads.find((t) => t.id === turn.threadId)?.name || "KnightCode";
	const body =
		turn.status === "failed"
			? "The turn failed"
			: turn.status === "interrupted"
				? "The turn was stopped"
				: "KnightCode finished a turn";
	const notification = new Notification(name, { body });
	notification.onclick = () => {
		void client.host("host/app/command", { command: "focus" });
		void openThread(turn.threadId);
	};
}

const NO_UNREAD: string[] = [];
export const selectUnread = (s: State): string[] => s.desktop?.unread ?? NO_UNREAD;

export function setUnread(threadId: string, unread: boolean): void {
	if (selectUnread(state).includes(threadId) === unread) return;
	updateDesktop((d) => {
		const rest = (d.unread ?? []).filter((id) => id !== threadId);
		return { ...d, unread: unread ? [...rest, threadId] : rest };
	});
}

/** Archive the threads idle past Settings › General's limit (archive-filter.ts, inactiveThreads); none when it is off. */
// Archives in flight: each archived notification reruns autoArchive before the others are acknowledged.
const autoArchiving = new Set<string>();
export async function autoArchive(now = Date.now()): Promise<void> {
	const days = selectPreferences(state).autoArchiveDays;
	if (!days) return;
	// One window archives for all, and never a thread another window has open.
	const { primary, heldElsewhere } = await client.host("host/window/role", {});
	if (!primary) return;
	const keep = [
		...(state.desktop?.pinnedThreads ?? []),
		...(state.view.kind === "thread" ? [state.view.id] : []),
		...heldElsewhere,
	];
	for (const t of inactiveThreads(state.threads, days, now, keep)) {
		if (autoArchiving.has(t.id)) continue;
		autoArchiving.add(t.id);
		void archive(t.id).finally(() => autoArchiving.delete(t.id));
	}
}

/** Codex's "Clear all unreads". */
export function clearUnread(): void {
	if (selectUnread(state).length) updateDesktop((d) => ({ ...d, unread: [] }));
}

export function pinThread(threadId: string, pinned: boolean): void {
	updateDesktop((d) => ({
		...d,
		pinnedThreads: pinned
			? [...d.pinnedThreads.filter((id) => id !== threadId), threadId]
			: d.pinnedThreads.filter((id) => id !== threadId),
	}));
}

/** The transcript as Markdown, for "Copy transcript". */
export function transcriptMarkdown(threadId: string): string {
	const view = state.held[threadId];
	if (!view) return "";
	const out: string[] = [];
	for (const turn of view.turns)
		for (const item of turn.items) {
			if (item.type === "userMessage") out.push(`**You:** ${item.text}`);
			else if (item.type === "agentMessage") out.push(`**KnightCode:** ${item.text}`);
			else if (item.type === "extensionMessage") out.push(`**${item.extension}:** ${item.text}`);
			else if (item.type === "toolCall") {
				// Consecutive calls form one list.
				const line = `- ${toolLine(item)}${item.status === "failed" ? " (failed)" : ""}`;
				if (out.at(-1)?.startsWith("- ")) out[out.length - 1] += `\n${line}`;
				else out.push(line);
			}
		}
	return out.join("\n\n");
}

/** A tool call as one line of text, after the transcript's tool rows. */
function toolLine(item: Extract<Item, { type: "toolCall" }>): string {
	const input = (item.input ?? {}) as Record<string, unknown>;
	const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
	const path = text("path") || text("file_path");
	switch (item.tool) {
		case "bash":
		case "powershell":
			return `Ran \`${text("command").split("\n")[0]}\``;
		case "read":
			return `Read \`${path}\``;
		case "edit":
			return `Edited \`${path}\``;
		case "write":
			return `Wrote \`${path}\``;
		case "grep":
		case "find":
		case "ls":
		case "glob":
			return `Searched${text("pattern") ? ` \`${text("pattern")}\`` : ""}${path ? ` in \`${path}\`` : ""}`;
		default: {
			const first = Object.values(input).find((v): v is string => typeof v === "string");
			return `\`${item.tool}\`${first ? ` ${first.split("\n")[0]}` : ""}`;
		}
	}
}

// --- workspaces, diffs and git (desktop-shell.md section 9.6) ---------------------------------

/** Reload an open Changes pane after something other than a turn changed the checkout (a commit, a switch). */
export function refreshDiff(threadId: string): void {
	set((s) => ({ ...s, diffVersion: { ...s.diffVersion, [threadId]: (s.diffVersion[threadId] ?? 0) + 1 } }));
}

/** Change the side panel; closing it also leaves full screen, so it reopens beside the chat. */
export function setPanel(panel: Partial<State["panel"]>): void {
	set((s) => ({ ...s, panel: { ...s.panel, ...panel, ...(panel.open === false ? { full: false } : {}) } }));
}

export function addComment(threadId: string, comment: DiffComment): void {
	set((s) => ({ ...s, comments: { ...s.comments, [threadId]: [...(s.comments[threadId] ?? []), comment] } }));
}

export function removeComment(threadId: string, comment: DiffComment): void {
	set((s) => ({
		...s,
		comments: { ...s.comments, [threadId]: (s.comments[threadId] ?? []).filter((c) => c !== comment) },
	}));
}

/** Move the chat and its uncommitted changes between its worktree and the main checkout. */
export async function handoff(
	threadId: string,
	to: "local" | "worktree",
	branch?: string,
): Promise<{ branch?: string } | RequestError> {
	try {
		const result = await client.request("thread/handoff", { threadId, to, ...(branch ? { branch } : {}) });
		for (const warning of result.warnings) toast(warning.message);
		updateThread(threadId, (v) => ({ ...v, thread: result.thread }));
		upsertSummary(result.thread);
		return { ...(result.branch ? { branch: result.branch } : {}) };
	} catch (error) {
		return error instanceof RequestError ? error : new RequestError("internal", errorText(error));
	}
}

/** Rebuild a deleted worktree from its snapshot, then open the thread in it. */
export async function restoreWorktree(threadId: string): Promise<void> {
	try {
		await client.request("thread/worktree/restore", { threadId });
		await resumeThread(threadId);
	} catch (error) {
		toast(errorText(error), "error");
	}
}

/**
 * The edited-files card's Undo and Reapply: the whole Last Turn in one request, which the server checks for every
 * file before it changes any, so a file edited since never leaves the others half undone. True when it went.
 */
export async function undoTurnEdits(threadId: string, turnId: string, reapply = false): Promise<boolean> {
	try {
		const { paths } = await client.request("thread/diff/revert", {
			threadId,
			scope: "lastTurn",
			turnId,
			...(reapply ? { reapply } : {}),
		});
		set((s) => {
			const { [turnId]: _was, ...undoneTurns } = s.undoneTurns;
			return { ...s, undoneTurns: reapply ? undoneTurns : { ...undoneTurns, [turnId]: true } };
		});
		const what = paths.length === 1 ? paths[0] : `${paths.length} files`;
		toast(`${reapply ? "Reapplied" : "Undid"} the changes to ${what}`, "success");
		return true;
	} catch (error) {
		toast(errorText(error), "error");
		return false;
	} finally {
		refreshDiff(threadId);
	}
}

/**
 * Codex's "Edit message", which the protocol cannot do in place: the thread forks just before the message (its
 * previous turn's last item) and the edited text goes to the fork. The first message starts a fresh thread instead.
 */
/** `images`: the edited message's own, which go with the replacement. */
export async function resendEdited(
	threadId: string,
	turnId: string,
	text: string,
	images?: ImageInput[],
): Promise<void> {
	// The first loaded turn may not be the thread's first: load what is before it, so the fork keeps that history.
	while (state.held[threadId]?.nextCursor && state.held[threadId]!.turns[0]?.id === turnId) {
		const loaded = state.held[threadId]!.turns.length;
		await loadEarlier(threadId);
		// A failed load (it toasts) adds nothing: stop rather than ask again forever.
		if ((state.held[threadId]?.turns.length ?? loaded) === loaded) break;
	}
	const view = state.held[threadId];
	if (!view) return;
	const at = view.turns.findIndex((t) => t.id === turnId);
	if (at === 0 && view.nextCursor) return toast("Could not load the earlier messages to edit this one", "error");
	const before = view.turns[at - 1]?.items.filter((i) => i.index !== undefined).at(-1);
	try {
		if (before) {
			const { thread } = await client.request("thread/fork", { threadId, atItemId: before.id });
			upsertSummary(thread);
			await openThread(thread.id);
			await send(thread.id, text, images);
		} else {
			const { thread } = view;
			// The thread's own cwd: inside a managed worktree that starts the new thread in the same worktree.
			await startThread(
				thread.cwd,
				text,
				{
				// thread/start takes only {provider, id}: the full ModelRef fails its parameter check.
				...(thread.model ? { model: { provider: thread.model.provider, id: thread.model.id } } : {}),
				...(thread.thinkingLevel ? { thinkingLevel: thread.thinkingLevel } : {}),
					approvalMode: thread.approvalMode,
				},
				images,
			);
		}
	} catch (error) {
		toast(errorText(error), "error");
	}
}

// The store holds the session (the server's state, held threads, the client's listeners). A hot update would start a
// second, empty store beside the live client, which never hears "ready" again, so an edit reloads the page instead.
import.meta.hot?.accept(() => window.location.reload());
