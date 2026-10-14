/**
 * One store per window (desktop-shell.md section 7.1): the sidebar slice from thread/list and sidebar
 * notifications, and per held thread its Thread, turns and items ordered by `index`, built from a
 * thread/resume snapshot plus notifications.
 */

import { useSyncExternalStore } from "react";
import type {
	ApprovalMode,
	ApprovalResult,
	Item,
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
import type { DesktopState } from "../shared/host-protocol.ts";
import { type AnyNotification, type AnyServerRequest, client, RequestError } from "./client.ts";

export type ModelInfo = ResultOf<"model/list">["models"][number];
/** A rendered item: its protocol value plus its top-level position (absent for nested calls). */
export type ViewItem = Item & { index?: number };
export interface ViewTurn extends Omit<Turn, "items"> {
	items: ViewItem[];
}
export interface Approval {
	id: RequestId;
	params: ServerRequestParams<"item/toolCall/requestApproval">;
}
export interface PendingMessage {
	clientMessageId: string;
	text: string;
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
	notice?: string;
}

export type View = { kind: "thread"; id: string } | { kind: "new"; cwd?: string };

export interface State {
	server: { state: "starting" | "ready" | "restarting" | "failed"; message?: string };
	desktop: DesktopState | undefined;
	threads: ThreadSummary[];
	view: View;
	held: Record<string, ThreadView>;
	opening: Record<string, string | undefined>;
	models: ModelInfo[];
	defaultModel: string | null;
	toasts: { id: number; text: string }[];
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
		for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i);
		offset += binary.length;
		if (chunk.eof) break;
		if (binary.length === 0) throw new Error("payload made no progress");
	}
	return JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset)));
}

const resolveTurn = async (wire: WireTurn): Promise<Turn> =>
	"payload" in wire ? ((await readPayload(wire.payload)) as Turn) : wire;
const resolveItem = async (wire: WireItem): Promise<Item> =>
	wire.type === "itemReference" ? ((await readPayload(wire.payload)) as Item) : wire;

/** Read-back items arrive in index order; nested calls carry no index (architecture.md section 4.2). */
function toView(turn: Turn): ViewTurn {
	let index = 0;
	return {
		...turn,
		items: turn.items.map((item) =>
			item.type === "toolCall" && item.parentItemId ? item : { ...item, index: index++ },
		),
	};
}

function placeItem(items: ViewItem[], item: ViewItem): ViewItem[] {
	const rest = items.filter((i) => i.id !== item.id);
	if (item.index === undefined) return [...rest, item];
	// Items at or after this index shift; the latest index wins (desktop-shell.md section 7.1).
	const before = rest.filter((i) => i.index === undefined || i.index < item.index!);
	const after = rest.filter((i) => i.index !== undefined && i.index >= item.index!);
	return [...before, item, ...after];
}

function withTurn(view: ThreadView, turnId: string, fn: (turn: ViewTurn) => ViewTurn): ThreadView {
	const index = view.turns.findIndex((t) => t.id === turnId);
	if (index === -1) return view;
	const turns = [...view.turns];
	turns[index] = fn(turns[index]!);
	return { ...view, turns };
}

// --- notifications ----------------------------------------------------------------------------

function upsertSummary(summary: ThreadSummary): void {
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
			set((s) => ({
				...s,
				view: s.view.kind === "thread" && s.view.id === oldThreadId ? { kind: "thread", id: thread.id } : s.view,
			}));
			await openThread(thread.id);
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

// Notifications apply in arrival order even when one awaits a payload.
let chain = Promise.resolve();
client.onNotification((n) => {
	chain = chain.then(() => applyNotification(n)).catch((error: unknown) => console.error(error));
});
client.onServerRequest((r) => {
	chain = chain.then(() => applyServerRequest(r));
});
client.onHostEvent((event) => {
	if (event.event !== "server/state") return;
	const wasReady = state.server.state === "ready";
	set((s) => ({ ...s, server: { state: event.state, message: event.message } }));
	if (event.state === "ready" && !wasReady) void connected();
});

// --- actions ----------------------------------------------------------------------------------

async function connected(): Promise<void> {
	try {
		const desktop = state.desktop ?? (await client.host("host/state/read", {}));
		set((s) => ({ ...s, desktop }));
		await Promise.all([refreshThreads(), refreshModels()]);
		// After a restart the new server has no subscriptions: resume what this window shows.
		for (const id of Object.keys(state.held)) void openThread(id);
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
	set((s) => ({ ...s, view: { kind: "new", cwd } }));
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
	set((s) => ({ ...s, view: { kind: "thread", id }, opening: { ...s.opening, [id]: undefined } }));
	try {
		const result = await client.request("thread/resume", { threadId: id });
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
				},
			},
		}));
		for (const warning of result.warnings) toast(warning.message);
	} catch (error) {
		const message =
			error instanceof RequestError && error.code === "threadLockedElsewhere"
				? "This thread is open in another KnightCode process."
				: errorText(error);
		set((s) => ({ ...s, opening: { ...s.opening, [id]: message } }));
	}
}

export async function startThread(
	cwd: string,
	text: string,
	options: { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel; approvalMode?: ApprovalMode },
): Promise<void> {
	const { thread, warnings } = await client.request("thread/start", { cwd, ...options });
	for (const warning of warnings) toast(warning.message);
	set((s) => ({
		...s,
		view: { kind: "thread", id: thread.id },
		held: {
			...s.held,
			[thread.id]: { thread, turns: [], queue: { steering: [], followUp: [] }, approvals: [], pending: [] },
		},
	}));
	await send(thread.id, text);
}

const newClientId = () => crypto.randomUUID();

/** Start a turn on an idle thread, queue on a running one (section 9.4). */
export async function send(threadId: string, text: string): Promise<void> {
	const view = state.held[threadId];
	if (!view) return;
	const running = view.turns.some((t) => t.status === "inProgress");
	if (running) {
		await client.request("turn/queue/add", { threadId, text }).catch((e: unknown) => toast(errorText(e)));
		return;
	}
	const clientMessageId = newClientId();
	updateThread(threadId, (v) => ({ ...v, pending: [...v.pending, { clientMessageId, text }] }));
	try {
		const result = await client.request("turn/start", { threadId, text, clientMessageId });
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

export async function steer(threadId: string, text: string): Promise<void> {
	const turn = state.held[threadId]?.turns.findLast((t) => t.status === "inProgress");
	if (!turn) return send(threadId, text);
	await client
		.request("turn/steer", { threadId, expectedTurnId: turn.id, text })
		.catch((e: unknown) => toast(errorText(e)));
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
