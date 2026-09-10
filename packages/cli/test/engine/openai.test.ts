import type { Api, AssistantMessage, Model } from "@knightcode/ai";
import { describe, expect, test } from "vitest";
import { parseChatRequest, toChunk, toContext } from "../../src/engine/openai.ts";

/** Only the fields toContext reads are meaningful; the rest satisfy the type. */
const model = {
	id: "m",
	name: "M",
	api: "openai-completions",
	provider: "faux",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
} as unknown as Model<Api>;

/** `partial`/`message` are unused by toChunk; a bare object keeps the tests readable. */
const message = {} as AssistantMessage;

describe("parseChatRequest", () => {
	test("accepts a minimal request", () => {
		const parsed = parseChatRequest({ model: "m", messages: [{ role: "user", content: "hi" }] });
		expect(parsed.model).toBe("m");
		expect(parsed.messages).toEqual([{ role: "user", content: "hi" }]);
		expect(parsed.stream).toBe(false);
	});

	test("carries stream, max_tokens and temperature through", () => {
		const parsed = parseChatRequest({
			model: "m",
			messages: [],
			stream: true,
			max_tokens: 64,
			temperature: 0.2,
		});
		expect(parsed.stream).toBe(true);
		expect(parsed.max_tokens).toBe(64);
		expect(parsed.temperature).toBe(0.2);
	});

	test("rejects a non-object body", () => {
		expect(() => parseChatRequest("nope")).toThrow();
		expect(() => parseChatRequest(null)).toThrow();
	});

	test("rejects a missing model", () => {
		expect(() => parseChatRequest({ messages: [] })).toThrow();
	});

	test("rejects messages that are not an array", () => {
		expect(() => parseChatRequest({ model: "m", messages: "nope" })).toThrow();
	});

	test("rejects an unknown role", () => {
		expect(() => parseChatRequest({ model: "m", messages: [{ role: "root", content: "x" }] })).toThrow();
	});

	test("rejects non-string content", () => {
		expect(() => parseChatRequest({ model: "m", messages: [{ role: "user", content: 42 }] })).toThrow();
	});
});

describe("toContext", () => {
	test("lifts a leading system message into systemPrompt", () => {
		const context = toContext(
			{
				model: "m",
				messages: [
					{ role: "system", content: "be terse" },
					{ role: "user", content: "hi" },
				],
			},
			model,
		);
		expect(context.systemPrompt).toBe("be terse");
		expect(context.messages).toHaveLength(1);
		expect(context.messages[0]).toMatchObject({ role: "user", content: "hi" });
	});

	test("leaves systemPrompt undefined when there is no system message", () => {
		const context = toContext({ model: "m", messages: [{ role: "user", content: "hi" }] }, model);
		expect(context.systemPrompt).toBeUndefined();
	});

	test("keeps turns in order", () => {
		const context = toContext(
			{
				model: "m",
				messages: [
					{ role: "user", content: "one" },
					{ role: "assistant", content: "two" },
					{ role: "user", content: "three" },
				],
			},
			model,
		);
		expect(context.messages.map((entry) => entry.role)).toEqual(["user", "assistant", "user"]);
	});

	test("assistant turns carry the model's provider and api", () => {
		const context = toContext({ model: "m", messages: [{ role: "assistant", content: "two" }] }, model);
		expect(context.messages[0]).toMatchObject({ role: "assistant", provider: "faux", model: "m" });
	});
});

describe("toChunk", () => {
	test("maps start to a role delta", () => {
		const chunk = toChunk({ type: "start", partial: message }, "id-1", "m");
		expect(chunk?.choices[0].delta.role).toBe("assistant");
		expect(chunk?.choices[0].finish_reason).toBeNull();
	});

	test("maps text_delta to a content delta", () => {
		const chunk = toChunk({ type: "text_delta", contentIndex: 0, delta: "hello", partial: message }, "id-1", "m");
		expect(chunk?.choices[0].delta.content).toBe("hello");
		expect(chunk?.object).toBe("chat.completion.chunk");
		expect(chunk?.model).toBe("m");
	});

	test("maps a normal stop", () => {
		const chunk = toChunk({ type: "done", reason: "stop", message }, "id-1", "m");
		expect(chunk?.choices[0].finish_reason).toBe("stop");
	});

	test("maps a length stop to the OpenAI name", () => {
		const chunk = toChunk({ type: "done", reason: "length", message }, "id-1", "m");
		expect(chunk?.choices[0].finish_reason).toBe("length");
	});

	test("maps a tool-use stop to tool_calls", () => {
		const chunk = toChunk({ type: "done", reason: "toolUse", message }, "id-1", "m");
		expect(chunk?.choices[0].finish_reason).toBe("tool_calls");
	});

	test("emits nothing for thinking deltas", () => {
		expect(
			toChunk({ type: "thinking_delta", contentIndex: 0, delta: "...", partial: message }, "id-1", "m"),
		).toBeUndefined();
	});

	test("emits nothing for text_end, which would duplicate the deltas", () => {
		expect(
			toChunk({ type: "text_end", contentIndex: 0, content: "hello", partial: message }, "id-1", "m"),
		).toBeUndefined();
	});
});
