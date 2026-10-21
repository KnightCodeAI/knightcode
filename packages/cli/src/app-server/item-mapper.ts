/**
 * Session events to protocol notifications for one thread (§4.3). Ids, order and statuses follow
 * transcript.ts: every top-level item carries its index in the turn, and the finalized message, not the
 * stream, decides an item's final content and position (§4.2).
 */

import type { AssistantMessage } from "@knightcode/ai";
import { calculateContextTokens } from "../core/compaction/index.ts";
import type { DiffComment, Item, TokenUsage, Turn, TurnQueue, WireTurn } from "@knightcode/app-server-protocol";
import type { AgentSession, AgentSessionEvent } from "../core/agent-session.ts";
import { addUsageToTotals, type UsageTotals } from "../core/usage-totals.ts";
import { getLatestCompactionEntry } from "../core/session-manager.ts";
import {
	openMarkerOf,
	TURN_END_TYPE,
	TURN_MARKER_TYPE,
	type TurnEnd,
	turnEndAt,
	turnEndEntryAt,
	turnEndOf,
} from "../extensions/turn-marker.ts";
import type { AppServerContext } from "./context.ts";
import { TURN_COMMENTS_ENTRY } from "./diff.ts";
import type { LoadedThread } from "./loaded-thread.ts";
import {
	assistantTimes,
	callStartedAt,
	entryTime,
	fileChangesOf,
	outputOf,
	textOf,
	toolCallStatus,
} from "./transcript.ts";

/** Steers the agent has not delivered yet, and the server's own queued inputs. */
export function queueOf(thread: LoadedThread): TurnQueue {
	return {
		steering: [...thread.session.getSteeringMessages()],
		followUp: thread.queued.map(({ id, text, images, review }) => ({
			id,
			// The user's own text: a reviewed input's prompt is the composed one.
			text: review?.text ?? text,
			...(images?.length || review ? { attachments: (images?.length ?? 0) + (review?.comments.length ?? 0) } : {}),
		})),
	};
}

/** Billed entry usage, plus the finalized reply not appended yet when subscribers hear message_end. */
export function usageOf(session: AgentSession, pending?: AssistantMessage): TokenUsage {
	const stats = session.getSessionStats();
	const { input, output, cacheRead, cacheWrite } = stats.tokens;
	const totals: UsageTotals = { input, output, cacheRead, cacheWrite, cost: stats.cost };
	const context = session.getContextUsage();
	let contextTokens = context?.tokens ?? undefined;
	if (pending) {
		addUsageToTotals(totals, pending.usage);
		if (pending.stopReason !== "aborted" && pending.stopReason !== "error") {
			const tokens = calculateContextTokens(pending.usage);
			if (tokens > 0) contextTokens = tokens;
		}
	}
	return {
		...totals,
		...(contextTokens === undefined ? {} : { contextTokens }),
		contextWindow: context?.contextWindow ?? session.model?.contextWindow ?? 0,
	};
}

type ToolCallItem = Extract<Item, { type: "toolCall" }>;
type TextItem = Extract<Item, { type: "agentMessage" | "reasoning" }>;
const copy = <T>(value: T): T => structuredClone(value);
const isNested = (item: Item) => item.type === "toolCall" && item.parentItemId !== undefined;

/** Wire deltas are bounded in UTF-8 bytes and never split a Unicode code point. */
export function* splitUtf8Delta(text: string, maxBytes = 49_152): Generator<string> {
	let start = 0;
	let offset = 0;
	let bytes = 0;
	for (const point of text) {
		const code = point.codePointAt(0)!;
		const width = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
		if (bytes + width > maxBytes) {
			yield text.slice(start, offset);
			start = offset;
			bytes = 0;
		}
		bytes += width;
		offset += point.length;
	}
	if (offset > start) yield text.slice(start, offset);
}

/** Per-turn ordinals and the next top-level index. Items between turns (idle compaction, an extension message) continue the last turn's. */
interface Counters {
	id: string;
	users: number;
	customs: number;
	compactions: number;
	assistants: number;
	/** Top-level items so far: the next item's index. */
	items: number;
}

const countersOf = (turn: Turn): Counters => ({
	id: turn.id,
	users: turn.items.filter((i) => i.type === "userMessage").length,
	customs: turn.items.filter((i) => i.type === "extensionMessage").length,
	compactions: turn.items.filter((i) => i.type === "compaction").length,
	// Unused after a turn ends: assistant messages only arrive inside a run.
	assistants: 0,
	items: turn.items.filter((i) => !isNested(i)).length,
});

/** The assistant message streaming now: where its items begin, and its text and thinking items by content index. */
interface Streaming {
	base: number;
	open: Map<number, TextItem>;
}

export class ItemMapper {
	private readonly thread: LoadedThread;
	private readonly broadcast: AppServerContext["broadcast"];
	private readonly onSettled: (turnId?: string) => void;
	private turn: Turn | undefined;
	/** The running turn's counters, or the last turn's between runs (restored from the file on load). */
	private counters: Counters | undefined;
	private streaming: Streaming | undefined;
	/** For the running turn's first user message. */
	private clientMessageId: string | undefined;
	private review: { comments: DiffComment[]; text: string } | undefined;
	private calls = new Map<string, ToolCallItem>();
	/** Top-level item id to its current index, for the snapshot's order. */
	private positions = new Map<string, number>();

	constructor(thread: LoadedThread, broadcast: AppServerContext["broadcast"], onSettled: (turnId?: string) => void) {
		this.thread = thread;
		this.broadcast = broadcast;
		this.onSettled = onSettled;
	}

	/** Continue the last turn's ordinals and indexes for items that arrive before the next run (§4.2). Called once after load. */
	restore(turns: readonly Turn[]): void {
		const last = turns.at(-1);
		this.counters = last ? countersOf(last) : undefined;
	}

	currentTurnId(): string | undefined {
		return this.turn?.id;
	}

	/** The running turn with every item so far, including partial text, in index order (§4.5). */
	snapshot(): Turn | undefined {
		return this.turn && this.ordered(this.turn);
	}

	/** Freeze a bounded wire snapshot without cloning large text/media; PayloadStore captures immutable segments synchronously. */
	wireSnapshot(): WireTurn | undefined {
		if (!this.turn) return undefined;
		const key = (item: Item): number =>
			item.type === "toolCall" && item.parentItemId !== undefined
				? (this.positions.get(item.parentItemId) ?? Number.MAX_SAFE_INTEGER) + 0.5
				: (this.positions.get(item.id) ?? Number.MAX_SAFE_INTEGER);
		const items = [...this.turn.items].sort((a, b) => key(a) - key(b));
		return this.thread.payloads.turn({ ...this.turn, items });
	}

	/** A raw copy for internal/small-test use only; never use this deep clone for a large wire snapshot. */
	private ordered(turn: Turn): Turn {
		const result = copy(turn);
		const key = (item: Item): number =>
			item.type === "toolCall" && item.parentItemId !== undefined
				? (this.positions.get(item.parentItemId) ?? Number.MAX_SAFE_INTEGER) + 0.5
				: (this.positions.get(item.id) ?? Number.MAX_SAFE_INTEGER);
		result.items.sort((a, b) => key(a) - key(b));
		return result;
	}

	private get manager() {
		return this.thread.session.sessionManager;
	}

	private notifyItem(
		method: "item/started" | "item/completed",
		item: Item,
		turnId: string,
		index: number | undefined,
	): void {
		if (index !== undefined) this.positions.set(item.id, index);
		this.thread.notify(method, {
			threadId: this.thread.id,
			turnId,
			item: this.thread.payloads.item(item),
			...(index === undefined ? {} : { index }),
		});
	}

	private started(item: Item, index: number | undefined, turnId = this.turn?.id): void {
		if (!turnId) return;
		if (this.turn?.id === turnId) this.turn.items.push(item);
		this.notifyItem("item/started", item, turnId, index);
	}

	private completed(item: Item, index: number | undefined, turnId = this.turn?.id): void {
		if (turnId) this.notifyItem("item/completed", item, turnId, index);
	}

	private removed(item: Item): void {
		if (!this.turn) return;
		this.turn.items = this.turn.items.filter((i) => i !== item);
		this.positions.delete(item.id);
		this.thread.notify("item/removed", { threadId: this.thread.id, turnId: this.turn.id, itemId: item.id });
	}

	/** An item that is the turn's next top-level item: user, custom, compaction. */
	private appendWhole(item: Item, counters: Counters): void {
		const index = counters.items++;
		this.started(item, index, counters.id);
		this.completed(item, index, counters.id);
	}

	handle(event: AgentSessionEvent): void {
		const threadId = this.thread.id;
		switch (event.type) {
			case "agent_start": {
				// A retry, follow-up or overflow recovery starts the agent again inside the same turn (§4.2).
				if (this.turn) return;
				let marker = openMarkerOf(this.manager.getBranch());
				if (!marker) {
					// The built-in was disabled or failed; write the marker here so ids still agree.
					console.error(`app-server: no turn marker in thread ${threadId}; writing one`);
					marker = this.manager.getEntry(this.manager.appendCustomEntry(TURN_MARKER_TYPE))!;
				}
				const id = marker.id;
				this.turn = { id, threadId, status: "inProgress", startedAt: entryTime(marker), items: [] };
				this.counters = { id, users: 0, customs: 0, compactions: 0, assistants: 0, items: 0 };
				this.streaming = undefined;
				this.calls.clear();
				this.positions.clear();
				this.broadcast("thread/status/changed", {
					threadId,
					status: { type: "active", waitingOn: this.thread.waitingOn() },
				});
				const requestId = this.thread.pendingTurnRequestId;
				this.thread.pendingTurnRequestId = undefined;
				this.clientMessageId = this.thread.pendingClientMessageId;
				this.thread.pendingClientMessageId = undefined;
				this.review = this.thread.pendingReview;
				this.thread.pendingReview = undefined;
				this.thread.notify("turn/started", { turn: { ...this.turn, items: [] }, ...(requestId ? { requestId } : {}) });
				this.thread.acceptTurnStart?.();
				return;
			}
			case "message_start":
				if (event.message.role === "assistant" && this.turn && this.counters) {
					this.streaming = { base: this.counters.items, open: new Map() };
				}
				return;
			case "message_update": {
				if (!this.turn || !this.counters || !this.streaming) return;
				const inner = event.assistantMessageEvent;
				if (inner.type !== "text_delta" && inner.type !== "thinking_delta") return;
				const id = `${this.turn.id}:${this.counters.assistants}:${inner.contentIndex}`;
				let item = this.streaming.open.get(inner.contentIndex);
				if (!item) {
					item =
						inner.type === "text_delta" ? { type: "agentMessage", id, text: "" } : { type: "reasoning", id, text: "" };
					item.startedAt = Date.now();
					// Provisional: blocks that start later (a tool call) may come before it; message_end settles it.
					const index = this.streaming.base + this.streaming.open.size;
					this.streaming.open.set(inner.contentIndex, item);
					this.started(item, index);
				}
				item.text += inner.delta;
				for (const delta of splitUtf8Delta(inner.delta))
					this.thread.notify(inner.type === "text_delta" ? "item/agentMessage/delta" : "item/reasoning/delta", {
						threadId,
						turnId: this.turn.id,
						itemId: id,
						delta,
					});
				return;
			}
			case "message_end": {
				const message = event.message;
				const counters = this.counters;
				if (!counters) return;
				if (message.role === "custom") {
					// Inside a run or between runs: an idle extension message belongs to the last turn, as on read-back.
					const item: Item = {
						type: "extensionMessage",
						id: `${counters.id}:custom:${counters.customs++}`,
						extension: message.customType,
						text: textOf(message.content),
					};
					const index = counters.items++;
					const turnId = counters.id;
					this.started(item, index, turnId);
					// Read-back has only the entry's time. Inside a run the session saves the entry right after
					// notifying subscribers, in the same synchronous step, so it exists one microtask later.
					queueMicrotask(() => {
						const leaf = this.manager.getLeafEntry();
						item.completedAt = leaf?.type === "custom_message" ? entryTime(leaf) : message.timestamp;
						this.completed(item, index, turnId);
					});
					return;
				}
				if (!this.turn) return;
				if (message.role === "user") {
					const content =
						typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
					const clientMessageId = this.clientMessageId;
					this.clientMessageId = undefined;
					const review = this.review;
					this.review = undefined;
					const id = `${this.turn.id}:user:${counters.users++}`;
					if (review) {
						try {
							this.manager.appendCustomEntry(TURN_COMMENTS_ENTRY, { itemId: id, ...review });
						} catch (error) {
							console.error(`app-server: could not record the review comments of ${id}: ${String(error)}`);
						}
					}
					this.appendWhole(
						{
							type: "userMessage",
							...(clientMessageId ? { clientMessageId } : {}),
							id,
							text: review?.text ?? textOf(content),
							...(review ? { comments: review.comments } : {}),
							completedAt: message.timestamp,
							images: content.flatMap((c) => (c.type === "image" ? [{ mimeType: c.mimeType, data: c.data }] : [])),
						},
						counters,
					);
				} else if (message.role === "assistant") {
					this.finishAssistant(message as AssistantMessage, counters);
				} else if (message.role === "toolResult") {
					// The saved result, after any message_end handler replaced it (§4.2): the call's outcome.
					const call = this.calls.get(message.toolCallId);
					if (!call || call.parentItemId) return;
					const content = message.content as Parameters<typeof outputOf>[0];
					call.status = toolCallStatus(message.isError, content);
					call.output = outputOf(content);
					call.completedAt = message.timestamp;
					const changes = fileChangesOf(call.tool, call.input, message.isError, message.details);
					if (changes.length > 0) call.fileChanges = changes;
					this.completed(call, this.positions.get(call.id));
				}
				return;
			}
			case "tool_execution_start": {
				const known = this.calls.get(event.toolCallId);
				if (known) {
					// Already an item since its assistant message ended; the snapshot shows it running.
					known.status = "running";
					return;
				}
				// A nested call (code mode): live only, no block of its own, no index (§4.2 table).
				const nested: ToolCallItem = {
					type: "toolCall",
					id: event.toolCallId,
					tool: event.toolName,
					input: event.args,
					status: "running",
					output: [],
					startedAt: Date.now(),
					...(event.parentToolCallId ? { parentItemId: event.parentToolCallId } : {}),
				};
				this.calls.set(event.toolCallId, nested);
				this.started(nested, undefined);
				return;
			}
			case "tool_execution_update": {
				if (!this.turn) return;
				const content = (event.partialResult as { content?: unknown })?.content;
				this.thread.notify("item/toolCall/outputDelta", {
					threadId,
					turnId: this.turn.id,
					itemId: event.toolCallId,
					output: this.thread.payloads.output(Array.isArray(content) ? outputOf(content) : []),
				});
				return;
			}
			case "tool_execution_end": {
				// Only nested calls complete here; a top-level call completes from its saved result (message_end).
				const item = this.calls.get(event.toolCallId);
				if (!item?.parentItemId) return;
				const content = (event.result as { content?: unknown })?.content;
				const blocks = Array.isArray(content) ? content : [];
				item.status = toolCallStatus(event.isError, blocks);
				item.output = outputOf(blocks);
				item.completedAt = Date.now();
				this.completed(item, undefined);
				return;
			}
			case "compaction_start":
				if (!this.turn)
					this.broadcast("thread/status/changed", {
						threadId,
						status: { type: "active", waitingOn: this.thread.waitingOn() },
					});
				return;
			case "compaction_end": {
				const counters = this.counters;
				const summary = (event as { result?: { summary?: string } }).result?.summary;
				if (counters && summary !== undefined) {
					this.appendWhole(
						{
							type: "compaction",
							id: `${counters.id}:compaction:${counters.compactions++}`,
							summary,
							completedAt: entryTime(getLatestCompactionEntry(this.manager.getBranch())!),
						},
						counters,
					);
				}
				if (!this.turn) {
					this.broadcast("thread/status/changed", { threadId, status: { type: "idle" } });
					this.onSettled();
				}
				return;
			}
			case "auto_retry_start":
				if (this.turn) {
					this.thread.notify("turn/retry", {
						threadId,
						turnId: this.turn.id,
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						delayMs: event.delayMs,
						error: event.errorMessage,
					});
				}
				return;
			case "queue_update":
				this.thread.notify("turn/queue/updated", {
					threadId,
					...queueOf(this.thread),
				});
				return;
			case "session_info_changed":
				this.broadcast("thread/name/updated", { threadId, name: event.name ?? "" });
				return;
			case "thinking_level_changed":
				this.thread.notify("thread/settings/updated", { thread: this.thread.toThread() });
				return;
			case "agent_settled":
				this.settled(event.aborted);
				return;
			default:
				return;
		}
	}

	/**
	 * The finalized assistant message, in block order (§4.2): tool calls start here, text and thinking items
	 * complete with their final text, and every item of the message gets its final index. A streamed item whose
	 * block is gone, or became another kind, is removed. Counted here, as readTurns counts the entry appended now.
	 */
	private finishAssistant(message: AssistantMessage, counters: Counters): void {
		const turn = this.turn!;
		const n = counters.assistants++;
		const streaming = this.streaming ?? { base: counters.items, open: new Map<number, TextItem>() };
		this.streaming = undefined;
		// Withdraw obsolete ids before starting replacements at those same ordinal positions.
		for (const [blockIndex, item] of streaming.open) {
			const block = message.content[blockIndex];
			const finalizedType =
				block?.type === "text" ? "agentMessage" : block?.type === "thinking" ? "reasoning" : undefined;
			if (item.type === finalizedType) continue;
			this.removed(item);
			streaming.open.delete(blockIndex);
		}
		let index = streaming.base;
		message.content.forEach((block, blockIndex) => {
			if (block.type === "toolCall") {
				// Every call starts here, executed or not: the order readTurns gives (§4.2).
				const call: ToolCallItem = {
					type: "toolCall",
					id: block.id,
					tool: block.name,
					input: block.arguments,
					status: "pending",
					output: [],
					startedAt: callStartedAt(message),
				};
				this.calls.set(block.id, call);
				this.started(call, index++);
				return;
			}
			if (block.type !== "text" && block.type !== "thinking") return;
			const type = block.type === "text" ? "agentMessage" : "reasoning";
			const text = block.type === "text" ? block.text : block.thinking;
			const existing = streaming.open.get(blockIndex);
			const item: TextItem = existing?.type === type ? existing : { type, id: `${turn.id}:${n}:${blockIndex}`, text };
			// A block that streamed no delta still exists on read-back; start it here.
			if (item !== existing) this.started(item, index);
			item.text = text;
			Object.assign(item, assistantTimes(message));
			this.completed(item, index++);
		});
		counters.items = index;
		this.thread.notify("thread/tokenUsage/updated", {
			threadId: this.thread.id,
			turnId: turn.id,
			usage: usageOf(this.thread.session, message),
		});
	}

	/**
	 * End the turn with the status of its end entry: the built-in wrote it just before (extension
	 * handlers run before subscribers), or it is written here with the same rule. Also the fallback
	 * when prompt() rejects after preflight without settling. Calls that never finished (an aborted
	 * reply's unexecuted calls, an interrupted execution) complete as failed, as readTurns reads a call
	 * without a result.
	 */
	settled(aborted: boolean, error?: unknown): void {
		const turn = this.turn;
		if (!turn) {
			this.onSettled();
			return;
		}
		this.turn = undefined;
		this.streaming = undefined;
		for (const call of this.calls.values()) {
			if (call.status !== "pending" && call.status !== "running") continue;
			call.status = "failed";
			this.completed(call, call.parentItemId ? undefined : this.positions.get(call.id), turn.id);
		}
		let end: TurnEnd | undefined = turnEndAt(this.manager.getBranch());
		if (!end) {
			end =
				error !== undefined
					? {
							status: "failed",
							error: { message: error instanceof Error ? error.message : String(error), kind: "other" },
						}
					: turnEndOf(aborted, this.manager.getBranch());
			try {
				this.manager.appendCustomEntry(TURN_END_TYPE, end);
			} catch (writeError) {
				// A closed manager or a lost lock: the turn still ends for the client; read-back says interrupted.
				console.error(`app-server: could not record the end of turn ${turn.id}: ${String(writeError)}`);
			}
		}
		const endEntry = turnEndEntryAt(this.manager.getBranch());
		turn.completedAt = endEntry ? entryTime(endEntry) : Date.now();
		turn.status = end.status;
		if (end.error) turn.error = end.error;
		const summary = this.thread.payloads.summary(turn);
		this.thread.notify("turn/completed", { turn: summary });
		this.broadcast("thread/turn/completed", { turn: summary });
		this.broadcast("thread/status/changed", { threadId: this.thread.id, status: { type: "idle" } });
		this.onSettled(turn.id);
	}
}
