/**
 * Session entries arrive as opaque JSON from the host (packages/cli's SessionEntry union).
 * This turns the flat log into what the transcript draws: user bubbles, assistant prose,
 * and runs of tool calls folded into one group per stretch between assistant messages.
 * Anything unrenderable is dropped rather than guessed at.
 */

export interface ToolResultView {
	text: string;
	isError: boolean;
	details?: unknown;
}

export interface ToolCallView {
	id: string;
	name: string;
	args: Record<string, unknown>;
	/** Absent while the tool is still running. */
	result?: ToolResultView;
}

export type Block =
	| { kind: "user"; id: string; text: string }
	| { kind: "assistant"; id: string; text: string; thinking?: string }
	| { kind: "tools"; id: string; calls: ToolCallView[] }
	| { kind: "note"; id: string; text: string };

type ToolsBlock = Extract<Block, { kind: "tools" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinBlocks(content: unknown, type: string, field: string): string {
	if (typeof content === "string") return type === "text" ? content : "";
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const block of content) {
		if (isRecord(block) && block.type === type && typeof block[field] === "string") text += block[field] as string;
	}
	return text;
}

function toolCallsOf(content: unknown): ToolCallView[] {
	if (!Array.isArray(content)) return [];
	const calls: ToolCallView[] = [];
	for (const block of content) {
		if (!isRecord(block) || block.type !== "toolCall") continue;
		if (typeof block.id !== "string" || typeof block.name !== "string") continue;
		calls.push({ id: block.id, name: block.name, args: isRecord(block.arguments) ? block.arguments : {} });
	}
	return calls;
}

/** Results follow their calls, so the match is almost always in the last group. */
function findCall(blocks: Block[], toolCallId: unknown): ToolCallView | undefined {
	if (typeof toolCallId !== "string") return undefined;
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const block = blocks[index];
		if (block?.kind !== "tools") continue;
		const call = block.calls.find((candidate) => candidate.id === toolCallId);
		if (call) return call;
	}
	return undefined;
}

export function toBlocks(entries: readonly unknown[]): Block[] {
	const blocks: Block[] = [];
	let open: ToolsBlock | undefined;
	const close = (): void => {
		open = undefined;
	};

	entries.forEach((raw, index) => {
		if (!isRecord(raw)) return;
		const id = typeof raw.id === "string" ? raw.id : `entry-${index}`;

		if (raw.type === "message" && isRecord(raw.message)) {
			const message = raw.message;
			if (message.role === "user") {
				const text = joinBlocks(message.content, "text", "text");
				if (text.trim().length > 0) {
					close();
					blocks.push({ kind: "user", id, text });
				}
				return;
			}
			if (message.role === "toolResult") {
				const call = findCall(blocks, message.toolCallId);
				if (call) {
					call.result = {
						text: joinBlocks(message.content, "text", "text"),
						isError: message.isError === true,
						details: message.details,
					};
				}
				return;
			}
			if (message.role === "assistant") {
				const text = joinBlocks(message.content, "text", "text");
				const thinking = joinBlocks(message.content, "thinking", "thinking").trim();
				const calls = toolCallsOf(message.content);
				if (text.trim().length > 0) {
					close();
					blocks.push({ kind: "assistant", id, text, thinking: thinking.length > 0 ? thinking : undefined });
				}
				if (calls.length > 0) {
					if (!open) {
						open = { kind: "tools", id: `${id}:tools`, calls: [] };
						blocks.push(open);
					}
					open.calls.push(...calls);
				}
			}
			return;
		}

		if (raw.type === "custom_message" && raw.display === true) {
			const text = joinBlocks(raw.content, "text", "text");
			if (text.trim().length > 0) {
				close();
				blocks.push({ kind: "note", id, text });
			}
			return;
		}
		if (raw.type === "compaction") {
			close();
			blocks.push({ kind: "note", id, text: "Context compacted" });
			return;
		}
		if (raw.type === "branch_summary") {
			close();
			blocks.push({ kind: "note", id, text: "Branch summarised" });
		}
	});

	return blocks;
}
