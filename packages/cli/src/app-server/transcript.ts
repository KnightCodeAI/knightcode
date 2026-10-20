/**
 * Turns and items read back from session entries (§4.2). Task 11's live
 * ItemMapper produces the same ids from session events, and both take a
 * marked turn's status from its end entry.
 */

import type { AssistantMessage } from "@knightcode/ai";
import type { FileChange, Item, ToolOutput, Turn } from "@knightcode/app-server-protocol";
import type { SessionEntry } from "../core/session-manager.ts";
import { TURN_COMMENTS_ENTRY, type TurnComments } from "./diff.ts";
import {
	classifyAssistantError,
	isTurnEnd,
	isTurnMarker,
	parseTurnEnd,
	type TurnEnd,
} from "../extensions/turn-marker.ts";

export const DECLINED_REASON = "The user rejected this tool call";
export const CANCELLED_REASON = "Tool call cancelled";

export const entryTime = (entry: SessionEntry): number => Date.parse(entry.timestamp);
export function assistantTimes(message: AssistantMessage): { startedAt: number; completedAt?: number } {
	return message.durationMs === undefined
		? { startedAt: message.timestamp }
		: { startedAt: message.timestamp, completedAt: message.timestamp + message.durationMs };
}
export const callStartedAt = (message: AssistantMessage): number => message.timestamp + (message.durationMs ?? 0);

type Content = readonly { type: string; text?: string; data?: string; mimeType?: string }[];

export function textOf(content: string | Content): string {
	if (typeof content === "string") return content;
	return content.flatMap((c) => (c.type === "text" && c.text !== undefined ? [c.text] : [])).join("");
}

export function outputOf(content: Content): ToolOutput[] {
	return content.flatMap((c): ToolOutput[] =>
		c.type === "text"
			? [{ type: "text", text: c.text ?? "" }]
			: c.type === "image"
				? [{ type: "image", mimeType: c.mimeType ?? "", data: c.data ?? "" }]
				: [],
	);
}

/** A call the approval gate blocked has an error result carrying exactly the decline reason. */
export function toolCallStatus(isError: boolean, content: Content): "completed" | "failed" | "declined" {
	if (!isError) return "completed";
	const reason = textOf(content);
	return reason === DECLINED_REASON || reason.startsWith(`${DECLINED_REASON}: `) ? "declined" : "failed";
}

const MAX_REPORTED_CHANGES = 1000;
const CHANGE_KINDS: ReadonlySet<string> = new Set(["add", "modify", "delete"]);

/** Keep an extension report only if every entry is well formed. */
function reportedChanges(details: unknown): FileChange[] | undefined {
	const reported =
		typeof details === "object" && details !== null ? (details as { fileChanges?: unknown }).fileChanges : undefined;
	if (!Array.isArray(reported) || reported.length > MAX_REPORTED_CHANGES) return undefined;
	const changes: FileChange[] = [];
	for (const entry of reported) {
		if (typeof entry !== "object" || entry === null) return undefined;
		const { path, kind, diff } = entry as { path?: unknown; kind?: unknown; diff?: unknown };
		if (typeof path !== "string" || typeof kind !== "string" || !CHANGE_KINDS.has(kind)) return undefined;
		if (diff !== undefined && typeof diff !== "string") return undefined;
		changes.push({
			path,
			kind: kind as FileChange["kind"],
			...(typeof diff === "string" && diff.length > 0 ? { diff } : {}),
		});
	}
	return changes;
}

export function fileChangesOf(tool: string, input: unknown, isError: boolean, details?: unknown): FileChange[] {
	if (isError) return [];
	if (tool === "edit" || tool === "write") {
		const path = typeof input === "object" && input !== null ? (input as { path?: unknown }).path : undefined;
		if (typeof path !== "string") return [];
		const { patch, created } =
			typeof details === "object" && details !== null ? (details as { patch?: unknown; created?: unknown }) : {};
		return [
			{
				path,
				kind: created === true ? "add" : "modify",
				...(typeof patch === "string" && patch.length > 0 ? { diff: patch } : {}),
			},
		];
	}
	return reportedChanges(details) ?? [];
}

interface Building {
	turn: Turn;
	marked: boolean;
	end?: TurnEnd;
	users: number;
	customs: number;
	compactions: number;
	assistants: number;
	lastAssistant?: AssistantMessage;
	calls: Map<string, Extract<Item, { type: "toolCall" }>>;
	unresolved: Set<string>;
}

export function readTurns(threadId: string, entries: readonly SessionEntry[], activeTurnId?: string): Turn[] {
	const turns: Building[] = [];
	let current: Building | undefined;
	const open = (id: string, marked: boolean, startedAt: number) => {
		current = {
			turn: { id, threadId, status: "completed", startedAt, items: [] },
			marked,
			users: 0,
			customs: 0,
			compactions: 0,
			assistants: 0,
			calls: new Map(),
			unresolved: new Set(),
		};
		turns.push(current);
	};
	for (const entry of entries) {
		if (isTurnMarker(entry)) {
			open(entry.id, true, entryTime(entry));
			continue;
		}
		if (isTurnEnd(entry)) {
			if (current?.marked) {
				current.end = parseTurnEnd(entry.type === "custom" ? entry.data : undefined);
				if (current.end) current.turn.completedAt = entryTime(entry);
			}
			continue;
		}
		// A user message after a turn's end starts a new prompt: steering and follow-ups come before the end.
		if (entry.type === "message" && entry.message.role === "user" && (!current?.marked || current.end !== undefined))
			open(entry.id, false, entry.message.timestamp);
		if (!current) continue;
		const t = current;
		if (entry.type === "compaction") {
			t.turn.items.push({
				type: "compaction",
				id: `${t.turn.id}:compaction:${t.compactions++}`,
				summary: entry.summary,
				completedAt: entryTime(entry),
			});
		} else if (entry.type === "custom_message") {
			t.turn.items.push({
				type: "extensionMessage",
				id: `${t.turn.id}:custom:${t.customs++}`,
				extension: entry.customType,
				text: textOf(entry.content as string | Content),
				completedAt: entryTime(entry),
			});
		} else if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "user") {
				const content =
					typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
				t.turn.items.push({
					type: "userMessage",
					id: `${t.turn.id}:user:${t.users++}`,
					text: textOf(content as Content),
					completedAt: message.timestamp,
					images: (content as Content).flatMap((c) =>
						c.type === "image" ? [{ mimeType: c.mimeType ?? "", data: c.data ?? "" }] : [],
					),
				});
			} else if (message.role === "assistant") {
				// Counted per entry, as the live mapper counts at message_end (§4.2).
				const n = t.assistants++;
				message.content.forEach((block, index) => {
					if (block.type === "text")
						t.turn.items.push({
							type: "agentMessage",
							id: `${t.turn.id}:${n}:${index}`,
							text: block.text,
							...assistantTimes(message),
						});
					else if (block.type === "thinking")
						t.turn.items.push({
							type: "reasoning",
							id: `${t.turn.id}:${n}:${index}`,
							text: block.thinking,
							...assistantTimes(message),
						});
					else if (block.type === "toolCall") {
						const call: Extract<Item, { type: "toolCall" }> = {
							type: "toolCall",
							id: block.id,
							tool: block.name,
							input: block.arguments,
							status: "failed",
							output: [],
							startedAt: callStartedAt(message),
						};
						t.calls.set(block.id, call);
						t.unresolved.add(block.id);
						t.turn.items.push(call);
					}
				});
				t.lastAssistant = message;
			} else if (message.role === "toolResult") {
				const call = t.calls.get(message.toolCallId);
				t.unresolved.delete(message.toolCallId);
				if (call) {
					call.status = toolCallStatus(message.isError, message.content as Content);
					call.output = outputOf(message.content as Content);
					call.completedAt = message.timestamp;
					// Part of the call item, so a result never adds or moves an item (§4.2).
					const changes = fileChangesOf(call.tool, call.input, message.isError, message.details);
					if (changes.length > 0) call.fileChanges = changes;
				}
			}
		}
	}
	// Review comments apply only to the user item their start produced, never to "the next user message".
	const reviews = new Map<string, TurnComments>();
	for (const entry of entries)
		if (entry.type === "custom" && entry.customType === TURN_COMMENTS_ENTRY) {
			const review = entry.data as TurnComments;
			reviews.set(review.itemId, review);
		}
	const result = turns.filter((t) => t.turn.items.length > 0);
	result.forEach((t) => {
		for (const item of t.turn.items) {
			const review = item.type === "userMessage" ? reviews.get(item.id) : undefined;
			if (review && item.type === "userMessage") {
				item.text = review.text;
				item.comments = review.comments;
			}
		}
		const active = t.turn.id === activeTurnId;
		if (t.marked) {
			if (t.end) {
				t.turn.status = t.end.status;
				if (t.end.error) t.turn.error = t.end.error;
			} else t.turn.status = active ? "inProgress" : "interrupted";
		} else if (active) t.turn.status = "inProgress";
		else if (t.lastAssistant) {
			const message = t.lastAssistant;
			t.turn.completedAt = assistantTimes(message).completedAt ?? message.timestamp;
			if (message.stopReason === "aborted") t.turn.status = "interrupted";
			else if (message.stopReason === "error") {
				t.turn.status = "failed";
				t.turn.error = {
					message: message.errorMessage ?? "the turn failed",
					kind: classifyAssistantError(message),
				};
			}
		}
		if (t.turn.status === "inProgress") {
			for (const id of t.unresolved) t.calls.get(id)!.status = "running";
		}
	});
	return result.map((t) => t.turn);
}

export function entryForItem(entries: readonly SessionEntry[], itemId: string): string | undefined {
	// Reading never removes an item, so presence is monotonic in the prefix length: bisect for the first one.
	const has = (length: number) =>
		readTurns("", entries.slice(0, length)).some((t) => t.items.some((item) => item.id === itemId));
	if (!has(entries.length)) return undefined;
	let low = 1;
	let high = entries.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (has(mid)) high = mid;
		else low = mid + 1;
	}
	return entries[low - 1].id;
}
