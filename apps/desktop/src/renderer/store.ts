/**
 * One store per window (desktop-shell.md section 7.1): the sidebar slice from thread/list and sidebar
 * notifications, and per held thread its Thread, turns and items ordered by `index`, built from a
 * thread/resume snapshot plus notifications.
 */

import { useSyncExternalStore } from "react";
import type {
	ApprovalMode,
	ApprovalResult,
	ImageInput,
	Item,
	LoginState,
	PayloadRef,
	RequestId,
	ResultOf,
	ServerRequestParams,
	ThinkingLevel,
	Thread,
	ThreadSummary,
	TokenUsage,
	Turn,
	TurnQueue,
	WireItem,
	WireTurn,
} from "@knightcode/app-server-protocol";
import { DEFAULT_PREFERENCES, type DesktopState, type Preferences } from "../shared/host-protocol.ts";
import { type AnyNotification, type AnyServerRequest, client, RequestError } from "./client.ts";
import { placeItem, toView, type ViewItem, type ViewTurn } from "./turns.ts";

export type ModelInfo = ResultOf<"model/list">["models"][number];
export type { ViewItem, ViewTurn };
export interface Approval {
	id: RequestId;
	params: ServerRequestParams<"item/toolCall/requestApproval">;
}
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
	approvals: Approval[];
	retry?: { attempt: number; maxAttempts: number; delayMs: number; error: string; at: number };
	pending: PendingMessage[];
	/** Older history: a thread/read cursor, absent once the first turn is loaded. */
	nextCursor?: string;
	notice?: string;
}

export type SettingsPage = "general" | "appearance" | "models" | "approvals" | "shortcuts" | "about";
export type View =
	| { kind: "thread"; id: string }
	| { kind: "new"; cwd?: string }
	| { kind: "settings"; page: SettingsPage }
	| { kind: "archive" };
export type Accounts = ResultOf<"account/list">;

export interface State {
	server: { state: "starting" | "ready" | "restarting" | "failed"; message?: string };
	desktop: DesktopState | undefined;
	threads: ThreadSummary[];
	view: View;
	held: Record<string, ThreadView>;
	/** Why the last resume failed; `code` is the server's error code, when it sent one. */
	opening: Record<string, { message: string; code?: string } | undefined>;
	models: ModelInfo[];
	defaultModel: string | null;
	toasts: { id: number; text: string }[];
	/** Back/forward over views (the title bar arrows). */
	history: { stack: View[]; index: number };
	accounts: Accounts | undefined;
	logins: Record<string, LoginState>;
	sidebarOpen: boolean;
	paletteOpen: boolean;
}

let state: State = {
	server: { state: "starting" },
	desktop: undefined,
	threads: [],
	view: { kind: "new" },
	held: {},
	opening: {},
	models: [],
	defaultModel: null,
	toasts: [],
	history: { stack: [{ kind: "new" }], index: 0 },
	accounts: undefined,
	logins: {},
	sidebarOpen: true,
	paletteOpen: false,
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

export function setSidebarOpen(open: boolean): void {
	set((s) => ({ ...s, sidebarOpen: open }));
}

export function setPaletteOpen(open: boolean): void {
	set((s) => ({ ...s, paletteOpen: open }));
}

function updateThread(id: string, fn: (view: ThreadView) => ThreadView): void {
	set((s) => (s.held[id] ? { ...s, held: { ...s.held, [id]: fn(s.held[id]!) } } : s));
}

let toastId = 0;
export function toast(text: string): void {
	const id = ++toastId;
	set((s) => ({ ...s, toasts: [...s.toasts, { id, text }] }));
	setTimeout(() => set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
	const summary: ThreadSummary = { ...thread, workspaceMode: thread.workspace.mode };
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
			return;
		case "thread/turn/completed":
			patchSummary(n.params.turn.threadId, { updatedAt: new Date().toISOString() });
			return;
		case "thread/replaced": {
			const { oldThreadId, thread } = n.params;
			if (state.view.kind === "thread" && state.view.id === oldThreadId) navigate({ kind: "thread", id: thread.id });
			// The server unloaded the old thread; holding it would resume it again after a restart.
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
						{ ...v, approvals: v.approvals.filter((a) => a.id !== n.params.id) },
					]),
				);
				return { ...s, held };
			});
			return;
		case "warning":
		case "error":
			toast(n.params.message);
			return;
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
	if (request.method !== "item/toolCall/requestApproval") return;
	updateThread(request.params.threadId, (v) => ({
		...v,
		approvals: [...v.approvals, { id: request.id, params: request.params }],
	}));
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
client.onHostEvent((event) => {
	if (event.event !== "server/state") return;
	const wasReady = state.server.state === "ready";
	set((s) => ({ ...s, server: { state: event.state, message: event.message } }));
	if (event.state === "ready" && !wasReady) void connected();
});
// Threads started elsewhere (the terminal, another window) send no notification here; coming back to the
// window is when they matter.
window.addEventListener("focus", () => {
	if (state.server.state === "ready") void refreshThreads().catch(() => {});
});

// --- actions ----------------------------------------------------------------------------------

async function connected(): Promise<void> {
	try {
		const desktop = state.desktop ?? (await client.host("host/state/read", {}));
		set((s) => ({ ...s, desktop }));
		await Promise.all([refreshThreads(), refreshModels(), refreshAccounts()]);
		// After a restart the new server has no subscriptions: resume what this window shows.
		for (const id of Object.keys(state.held)) void resumeThread(id);
	} catch (error) {
		toast(errorText(error));
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
	const { models, default: defaultModel } = await client.request("model/list", {});
	set((s) => ({ ...s, models, defaultModel }));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function updateDesktop(fn: (d: DesktopState) => DesktopState): void {
	if (!state.desktop) return;
	const desktop = fn(state.desktop);
	set((s) => ({ ...s, desktop }));
	clearTimeout(saveTimer);
	saveTimer = setTimeout(
		() => void client.host("host/state/write", { state: desktop }).catch((e: unknown) => toast(errorText(e))),
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
					approvals: s.held[id]?.approvals ?? [],
					pending: s.held[id]?.pending ?? [],
					...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
				},
			},
		}));
		for (const warning of result.warnings) toast(warning.message);
		await drain();
	} catch (error) {
		const code = error instanceof RequestError ? error.code : undefined;
		const message =
			code === "threadLockedElsewhere" ? "This thread is open in another KnightCode process." : errorText(error);
		set((s) => ({ ...s, opening: { ...s.opening, [id]: { message, ...(code ? { code } : {}) } } }));
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
	options: { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel; approvalMode?: ApprovalMode },
	images?: ImageInput[],
): Promise<void> {
	const { thread, warnings } = await client.request("thread/start", { cwd, ...options });
	for (const warning of warnings) toast(warning.message);
	navigate({ kind: "thread", id: thread.id });
	set((s) => ({
		...s,
		held: {
			...s.held,
			[thread.id]: { thread, turns: [], queue: { steering: [], followUp: [] }, approvals: [], pending: [] },
		},
	}));
	await send(thread.id, text, images);
}

const newClientId = () => crypto.randomUUID();

/** The composer is already cleared: keep a failed queue or steer as a failed bubble with Retry, not a toast. */
const failedSend = (threadId: string, text: string, images: ImageInput[] | undefined) => (error: unknown) =>
	updateThread(threadId, (v) => ({
		...v,
		pending: [...v.pending, { clientMessageId: newClientId(), text, images, failed: errorText(error) }],
	}));

/** Start a turn on an idle thread, queue on a running one (section 9.4). */
export async function send(threadId: string, text: string, images?: ImageInput[]): Promise<void> {
	const view = state.held[threadId];
	if (!view) return;
	const running = view.turns.some((t) => t.status === "inProgress");
	if (running) {
		await client
			.request("turn/queue/add", { threadId, text, ...(images?.length ? { images } : {}) })
			.catch(failedSend(threadId, text, images));
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
		});
		if (result.status !== "started")
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
	await client
		.request("turn/interrupt", turn ? { threadId, turnId: turn.id } : { threadId })
		.catch((e: unknown) => toast(errorText(e)));
}

export async function removeQueued(threadId: string, queueId: string): Promise<void> {
	await client.request("turn/queue/remove", { threadId, queueId }).catch((e: unknown) => toast(errorText(e)));
}

export function dismissPending(threadId: string, clientMessageId: string): void {
	updateThread(threadId, (v) => ({ ...v, pending: v.pending.filter((p) => p.clientMessageId !== clientMessageId) }));
}

export function answerApproval(threadId: string, approval: Approval, result: ApprovalResult): void {
	client.respond<"item/toolCall/requestApproval">(approval.id, result);
	updateThread(threadId, (v) => ({ ...v, approvals: v.approvals.filter((a) => a.id !== approval.id) }));
}

export async function updateSettings(
	threadId: string,
	settings: { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel; approvalMode?: ApprovalMode },
): Promise<void> {
	try {
		const { thread } = await client.request("thread/settings/update", { threadId, ...settings });
		updateThread(threadId, (v) => ({ ...v, thread }));
	} catch (error) {
		toast(errorText(error));
	}
}

export async function archive(threadId: string): Promise<void> {
	await client.request("thread/archive", { threadId }).catch((e: unknown) => toast(errorText(e)));
	if (state.view.kind === "thread" && state.view.id === threadId) showNew();
}

export async function rename(threadId: string, name: string): Promise<void> {
	await client.request("thread/name/set", { threadId, name }).catch((e: unknown) => toast(errorText(e)));
}

export async function compact(threadId: string): Promise<void> {
	await client.request("thread/compact", { threadId }).catch((e: unknown) => toast(errorText(e)));
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
		toast(errorText(error));
	}
}

export async function refreshAccounts(): Promise<void> {
	try {
		const accounts = await client.request("account/list", {});
		set((s) => ({ ...s, accounts }));
	} catch (error) {
		toast(errorText(error));
	}
}

export async function startLogin(provider: string, type: "oauth" | "api_key"): Promise<string | undefined> {
	try {
		const { loginId } = await client.request("account/login/start", { provider, type });
		return loginId;
	} catch (error) {
		toast(errorText(error));
		return undefined;
	}
}

export async function answerLogin(loginId: string, value: string): Promise<void> {
	await client.request("account/login/answer", { loginId, value }).catch((e: unknown) => toast(errorText(e)));
}

export async function cancelLogin(loginId: string): Promise<void> {
	await client.request("account/login/cancel", { loginId }).catch(() => {});
	set((s) => {
		const { [loginId]: _, ...logins } = s.logins;
		return { ...s, logins };
	});
}

export async function logout(provider: string): Promise<void> {
	await client.request("account/logout", { provider }).catch((e: unknown) => toast(errorText(e)));
	await Promise.all([refreshAccounts(), refreshModels()]);
}

/** The terminal and the desktop share one default model, in settings.json. */
export async function setDefaultModel(model: ModelInfo): Promise<void> {
	try {
		await client.request("config/write", { scope: "global", key: "defaultProvider", value: model.provider });
		await client.request("config/write", { scope: "global", key: "defaultModel", value: model.id });
		await refreshModels();
	} catch (error) {
		toast(errorText(error));
	}
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
	updateDesktop((d) => ({ ...d, preferences: { ...(d.preferences ?? DEFAULT_PREFERENCES), [key]: value } }));
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
	await client.request("thread/unarchive", { threadId }).catch((e: unknown) => toast(errorText(e)));
}

export async function deleteThread(threadId: string): Promise<void> {
	await client.request("thread/delete", { threadId }).catch((e: unknown) => toast(errorText(e)));
}

export async function fork(threadId: string, atItemId?: string): Promise<void> {
	try {
		const { thread } = await client.request("thread/fork", atItemId ? { threadId, atItemId } : { threadId });
		upsertSummary(thread);
		await openThread(thread.id);
	} catch (error) {
		toast(errorText(error));
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
