export interface TranscriptEntry {
	role: string;
	text: string;
	toolCalls: Array<{ name: string; arguments: unknown }>;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: string; text: string } =>
				typeof block === "object" && block !== null && (block as { type: string }).type === "text",
		)
		.map((block) => block.text)
		.join("");
}

function toolCallsOf(content: unknown): Array<{ name: string; arguments: unknown }> {
	if (!Array.isArray(content)) return [];
	return content
		.filter(
			(block): block is { type: string; name: string; arguments: unknown } =>
				typeof block === "object" && block !== null && (block as { type: string }).type === "toolCall",
		)
		.map((block) => ({ name: block.name, arguments: block.arguments }));
}

/** Session entries arrive as opaque JSON from the host; anything unrenderable is dropped. */
export function toTranscriptEntry(entry: unknown): TranscriptEntry | undefined {
	const record = entry as { type?: string; message?: { role?: string; content?: unknown } };
	if (record.type !== "message" || !record.message) return undefined;
	const text = textOf(record.message.content);
	const toolCalls = toolCallsOf(record.message.content);
	if (text.trim().length === 0 && toolCalls.length === 0) return undefined;
	return { role: record.message.role ?? "assistant", text, toolCalls };
}
