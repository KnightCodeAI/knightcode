// Context assembled by rules (spec section 6): before each request, recent exchanges go in full and older ones are
// shortened, with no model call, so a long thread reaches a paid summary only when even this does not fit. Only text
// is shortened: every message, tool call and tool result stays, so call/result pairing and the cached prefix's
// structure are kept. What was cut stays reachable with read_history.
import type { Message } from "@knightcode/ai";

/** The newest messages always go in full. */
export const KEEP_RECENT = 30;
const TEXT_LIMIT = 2_000;
const TEXT_KEEP = 1_000;
const RESULT_LIMIT = 600;
const RESULT_KEEP = 400;
const NOTE = "\n…(shortened; read_history has the rest)";

const shorten = (text: string, limit: number, keep: number) => (text.length > limit ? `${text.slice(0, keep)}${NOTE}` : text);

/** `messages` with the text of all but the newest `keep` shortened; the same array when nothing changes. */
export function shortenOldMessages(messages: readonly Message[], keep = KEEP_RECENT): readonly Message[] {
	if (messages.length <= keep) return messages;
	let changed = false;
	const out = messages.map((message, index) => {
		if (index >= messages.length - keep || message.role === "system") return message;
		const [limit, kept] = message.role === "toolResult" ? [RESULT_LIMIT, RESULT_KEEP] : [TEXT_LIMIT, TEXT_KEEP];
		if (typeof message.content === "string") {
			const content = shorten(message.content, limit, kept);
			if (content === message.content) return message;
			changed = true;
			return { ...message, content } as Message;
		}
		let touched = false;
		const content = (message.content as { type: string; text?: string }[]).map((block) => {
			if (block.type !== "text" || typeof block.text !== "string") return block;
			const text = shorten(block.text, limit, kept);
			if (text === block.text) return block;
			touched = true;
			return { ...block, text };
		});
		if (!touched) return message;
		changed = true;
		return { ...message, content } as Message;
	});
	return changed ? out : messages;
}
