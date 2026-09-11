/**
 * OpenAI wire translation.
 *
 * Seams 2 and 3 in the IDE reuse Zed's OpenAI-compatible client shapes, so the
 * engine speaks OpenAI on the wire and translates to KnightCode's `Context` and
 * `AssistantMessageEvent` here. Pure functions, no I/O.
 */

import type { Api, AssistantMessageEvent, Context, Message, Model, Usage } from "@knightcode/ai";

export interface OpenAIChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface OpenAIChatRequest {
	model: string;
	messages: OpenAIChatMessage[];
	/** Absent means non-streaming, as in the OpenAI API. `parseChatRequest` always sets it. */
	stream?: boolean;
	max_tokens?: number;
	temperature?: number;
}

export interface OpenAIChatChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: { index: 0; delta: { role?: "assistant"; content?: string }; finish_reason: string | null }[];
}

export class OpenAIRequestError extends Error {}

const ROLES = new Set(["system", "user", "assistant"]);

export function parseChatRequest(body: unknown): OpenAIChatRequest {
	if (typeof body !== "object" || body === null) throw new OpenAIRequestError("body must be an object");
	const record = body as Record<string, unknown>;
	if (typeof record.model !== "string" || record.model.length === 0) {
		throw new OpenAIRequestError("model is required");
	}
	if (!Array.isArray(record.messages)) throw new OpenAIRequestError("messages must be an array");
	const messages: OpenAIChatMessage[] = record.messages.map((entry: unknown) => {
		if (typeof entry !== "object" || entry === null) throw new OpenAIRequestError("message must be an object");
		const message = entry as Record<string, unknown>;
		if (typeof message.role !== "string" || !ROLES.has(message.role)) {
			throw new OpenAIRequestError(`unsupported role: ${String(message.role)}`);
		}
		if (typeof message.content !== "string") throw new OpenAIRequestError("content must be a string");
		return { role: message.role as OpenAIChatMessage["role"], content: message.content };
	});
	return {
		model: record.model,
		messages,
		stream: record.stream === true,
		max_tokens: typeof record.max_tokens === "number" ? record.max_tokens : undefined,
		temperature: typeof record.temperature === "number" ? record.temperature : undefined,
	};
}

/** History turns are replayed, not generated, so they carry no usage. */
const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * `model` is required because `AssistantMessage` carries `api`, `provider` and
 * `model`: a replayed assistant turn cannot be constructed without them.
 */
export function toContext(request: OpenAIChatRequest, model: Model<Api>): Context {
	let systemPrompt: string | undefined;
	const rest = [...request.messages];
	if (rest[0]?.role === "system") systemPrompt = rest.shift()?.content;
	const messages: Message[] = rest.map((message) => {
		const timestamp = Date.now();
		if (message.role === "assistant") {
			return {
				role: "assistant",
				content: [{ type: "text", text: message.content }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: ZERO_USAGE,
				stopReason: "stop",
				timestamp,
			};
		}
		return { role: "user", content: message.content, timestamp };
	});
	return { systemPrompt, messages };
}

export function toChunk(event: AssistantMessageEvent, id: string, model: string): OpenAIChatChunk | undefined {
	const envelope = (delta: { role?: "assistant"; content?: string }, finishReason: string | null): OpenAIChatChunk => ({
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	});

	switch (event.type) {
		case "start":
			return envelope({ role: "assistant" }, null);
		case "text_delta":
			return envelope({ content: event.delta }, null);
		case "done":
			return envelope({}, event.reason === "toolUse" ? "tool_calls" : event.reason === "length" ? "length" : "stop");
		default:
			// text_end repeats what the deltas already carried. Thinking and
			// tool-call events have no equivalent here: seam 2 surfaces are
			// single-turn text edits, and tools go through ACP.
			return undefined;
	}
}
