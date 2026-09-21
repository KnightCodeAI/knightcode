import { afterEach, describe, expect, it, vi } from "vitest";
import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import { MODELS } from "../src/models.generated.ts";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";
import { metaProvider } from "../src/providers/meta.ts";
import { builtinProviders } from "../src/providers/all.ts";
import type { Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

// AGENTS.md requires a new provider to carry deterministic coverage of request construction,
// streaming/SSE parsing and catalog presence. The OAuth flow has its own file; the inference
// suites in stream.test.ts and tokens.test.ts need a live key and self-skip without one, so
// nothing there runs in an ordinary package test.

const META_MODEL = "muse-spark-1.3";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function completedSSE(text: string): string {
	return `${[
		`data: ${JSON.stringify({
			type: "response.output_item.added",
			item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
		})}`,
		`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}`,
		`data: ${JSON.stringify({
			type: "response.output_item.done",
			item: {
				type: "message",
				id: "msg_1",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text }],
			},
		})}`,
		`data: ${JSON.stringify({
			type: "response.completed",
			response: {
				status: "completed",
				usage: {
					input_tokens: 5,
					output_tokens: 3,
					total_tokens: 8,
					input_tokens_details: { cached_tokens: 0 },
				},
			},
		})}`,
	].join("\n\n")}\n\n`;
}

function sseBody(text: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(completedSSE(text)));
			controller.close();
		},
	});
}

describe("Meta provider catalog", () => {
	it("is registered among the built-in providers", () => {
		const meta = builtinProviders().find((provider) => provider.id === "meta");
		expect(meta).toBeDefined();
		expect(meta?.name).toBe("Meta");
		expect(meta?.baseUrl).toBe("https://api.meta.ai/v1");
		// The api lives on the models, not the provider record.
		expect(meta?.getModels().every((model) => model.api === "openai-responses")).toBe(true);
	});

	it("ships the default model in the generated catalog", () => {
		expect(Object.keys(MODELS.meta)).toContain(META_MODEL);
		const model = MODELS.meta[META_MODEL];
		expect(model.provider).toBe("meta");
		expect(model.api).toBe("openai-responses");
		expect(model.baseUrl).toBe("https://api.meta.ai/v1");
		expect(model.contextWindow).toBeGreaterThan(0);
		expect(model.maxTokens).toBeGreaterThan(0);
	});

	it("exposes every catalog model through the provider", () => {
		const ids = metaProvider()
			.getModels()
			.map((model) => model.id);
		expect(ids).toContain(META_MODEL);
		expect(ids).toEqual(Object.keys(MODELS.meta));
	});

	// Subscription sign-in mints a key, but an API key must work on its own like any provider.
	it("resolves an API key from META_API_KEY", () => {
		// findEnvKeys only reports variables that are actually set, so the env is supplied here
		// rather than mutating the process.
		expect(findEnvKeys("meta", { META_API_KEY: "meta-key-from-env" })).toEqual(["META_API_KEY"]);
		expect(getEnvApiKey("meta", { META_API_KEY: "meta-key-from-env" })).toBe("meta-key-from-env");
		expect(findEnvKeys("meta", {})).toBeUndefined();
	});
});

describe("Meta request construction", () => {
	it("posts to the Meta responses endpoint with the key as a bearer token", async () => {
		let seenUrl = "";
		let seenAuth: string | null = null;
		let seenBody: Record<string, unknown> = {};

		const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			seenUrl = typeof input === "string" ? input : input.toString();
			const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
			seenAuth = headers.get("authorization");
			if (typeof init?.body === "string") seenBody = JSON.parse(init.body) as Record<string, unknown>;
			return new Response(sseBody("Hi"), { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		vi.stubGlobal("fetch", fetchMock);

		const model = MODELS.meta[META_MODEL] as Model<"openai-responses">;
		const context = normalizeContext({
			systemPrompt: "Be brief.",
			messages: [{ role: "user", content: "Say hi", timestamp: Date.now() }],
		});

		for await (const _event of streamOpenAIResponses(model, context, { apiKey: "meta-test-key" })) {
			// drained below; this loop only drives the request
		}

		expect(seenUrl.startsWith("https://api.meta.ai/v1")).toBe(true);
		expect(seenUrl).toContain("/responses");
		expect(seenAuth).toBe("Bearer meta-test-key");
		expect(seenBody.model).toBe(META_MODEL);
	});
});

describe("Meta streaming", () => {
	it("parses a Responses SSE stream into text deltas and a final message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(sseBody("Hello from Meta"), {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					}),
			),
		);

		const model = MODELS.meta[META_MODEL] as Model<"openai-responses">;
		const context = normalizeContext({
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		});

		let deltas = "";
		let final: string | undefined;
		let stopReason: string | undefined;
		for await (const event of streamOpenAIResponses(model, context, { apiKey: "meta-test-key" })) {
			if (event.type === "text_delta") deltas += event.delta;
			if (event.type === "done") {
				final = event.message.content.find((block) => block.type === "text")?.text;
				stopReason = event.message.stopReason;
			}
		}

		expect(deltas).toBe("Hello from Meta");
		expect(final).toBe("Hello from Meta");
		expect(stopReason).toBe("stop");
	});

	it("surfaces an API error rather than hanging", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { message: "Muse subscription required" } }), {
						status: 403,
						headers: { "content-type": "application/json" },
					}),
			),
		);

		const model = MODELS.meta[META_MODEL] as Model<"openai-responses">;
		const context = normalizeContext({
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		});

		let errored = false;
		try {
			for await (const event of streamOpenAIResponses(model, context, { apiKey: "meta-test-key" })) {
				if (event.type === "error") errored = true;
			}
		} catch {
			errored = true;
		}
		expect(errored).toBe(true);
	});
});
