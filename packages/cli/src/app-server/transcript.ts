/**
 * Turns and items read back from session entries (§4.2). Task 11's live
 * ItemMapper produces the same ids from session events, and both take a
 * marked turn's status from its end entry.
 */

import type { FileChange, Item, ToolOutput, Turn } from "@knightcode/app-server-protocol";
import type { SessionEntry } from "../core/session-manager.ts";
import { isTurnEnd, isTurnMarker, parseTurnEnd, type TurnEnd } from "../extensions/turn-marker.ts";

export const DECLINED_REASON = "The user rejected this tool call";
export const CANCELLED_REASON = "Tool call cancelled";

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
	return textOf(content) === DECLINED_REASON ? "declined" : "failed";
}

// ponytail: `write` reports "modify" even for a new file; Phase B's diff knows the truth.
export function fileChangesOf(tool: string, input: unknown, isError: boolean): FileChange[] {
	if (isError || (tool !== "edit" && tool !== "write")) return [];
	const path = typeof input === "object" && input !== null ? (input as { path?: unknown }).path : undefined;
	return typeof path === "string" ? [{ path, kind: "modify" }] : [];
}

interface Building {
	turn: Turn;
	marked: boolean;
	end?: TurnEnd;
	users: number;
	customs: number;
	compactions: number;
	assistants: number;
	lastStop?: string;
	lastError?: string;
	calls: Map<string, Extract<Item, { type: "toolCall" }>>;
	unresolved: Set<string>;
}

const isUser = (entry: SessionEntry) => entry.type === "message" && entry.message.role === "user";

export function readTurns(threadId: string, entries: readonly SessionEntry[], activeTurnId?: string): Turn[] {
	const turns: Building[] = [];
	let current: Building | undefined;
	const open = (id: string, marked: boolean) => {
		current = {
			turn: { id, threadId, status: "completed", items: [] },
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
			open(entry.id, true);
			continue;
		}
		if (isTurnEnd(entry)) {
			if (current?.marked) current.end = parseTurnEnd(entry.type === "custom" ? entry.data : undefined);
			continue;
		}
		// A user message after a turn's end starts a new prompt: steering and follow-ups come before the end.
		if (isUser(entry) && (!current?.marked || current.end !== undefined)) open(entry.id, false);
		if (!current) continue;
		const t = current;
		if (entry.type === "compaction") {
			t.turn.items.push({
				type: "compaction",
				id: `${t.turn.id}:compaction:${t.compactions++}`,
				summary: entry.summary,
			});
		} else if (entry.type === "custom_message") {
			t.turn.items.push({
				type: "extensionMessage",
				id: `${t.turn.id}:custom:${t.customs++}`,
				extension: entry.customType,
				text: textOf(entry.content as string | Content),
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
					images: (content as Content).flatMap((c) =>
						c.type === "image" ? [{ mimeType: c.mimeType ?? "", data: c.data ?? "" }] : [],
					),
				});
			} else if (message.role === "assistant") {
				// Counted per entry, as the live mapper counts at message_end (§4.2).
				const n = t.assistants++;
				message.content.forEach((block, index) => {
					if (block.type === "text")
						t.turn.items.push({ type: "agentMessage", id: `${t.turn.id}:${n}:${index}`, text: block.text });
					else if (block.type === "thinking")
						t.turn.items.push({ type: "reasoning", id: `${t.turn.id}:${n}:${index}`, text: block.thinking });
					else if (block.type === "toolCall") {
						const call: Extract<Item, { type: "toolCall" }> = {
							type: "toolCall",
							id: block.id,
							tool: block.name,
							input: block.arguments,
							status: "failed",
							output: [],
						};
						t.calls.set(block.id, call);
						t.unresolved.add(block.id);
						t.turn.items.push(call);
					}
				});
				t.lastStop = message.stopReason;
				t.lastError = message.errorMessage;
			} else if (message.role === "toolResult") {
				const call = t.calls.get(message.toolCallId);
				t.unresolved.delete(message.toolCallId);
				if (call) {
					call.status = toolCallStatus(message.isError, message.content as Content);
					call.output = outputOf(message.content as Content);
					// Part of the call item, so a result never adds or moves an item (§4.2).
					const changes = fileChangesOf(call.tool, call.input, message.isError);
					if (changes.length > 0) call.fileChanges = changes;
				}
			}
		}
	}
	const result = turns.filter((t) => t.turn.items.length > 0);
	result.forEach((t) => {
		const active = t.turn.id === activeTurnId;
		if (t.marked) {
			if (t.end) {
				t.turn.status = t.end.status;
				if (t.end.error) t.turn.error = t.end.error;
			} else t.turn.status = active ? "inProgress" : "interrupted";
		} else if (active) t.turn.status = "inProgress";
		else if (t.lastStop === "aborted") t.turn.status = "interrupted";
		else if (t.lastStop === "error") {
			t.turn.status = "failed";
			if (t.lastError) t.turn.error = t.lastError;
		}
		if (t.turn.status === "inProgress") {
			for (const id of t.unresolved) t.calls.get(id)!.status = "running";
		}
	});
	return result.map((t) => t.turn);
}

// ponytail: replays the reader per entry, O(n²) on the branch; index items while reading if fork latency shows up.
export function entryForItem(entries: readonly SessionEntry[], itemId: string): string | undefined {
	for (let i = 0; i < entries.length; i++) {
		const turns = readTurns("", entries.slice(0, i + 1));
		if (turns.some((t) => t.items.some((item) => item.id === itemId))) return entries[i].id;
	}
	return undefined;
}
