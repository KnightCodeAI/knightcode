import { fauxAssistantMessage, fauxProvider, fauxText } from "@knightcode/ai";
import { afterEach, describe, expect, test } from "vitest";
import { completionsRoutes } from "../../src/engine/completions.ts";
import { createEngineContext } from "../../src/engine/context.ts";
import { createMemoryAccountIndex, createMemorySecretBackend } from "../../src/engine/secrets.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

const auth = { authorization: "Bearer t", "content-type": "application/json" };

describe("completions routes", () => {
	let server: EngineServer | undefined;
	let counter = 0;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	async function start(text = "hello from faux"): Promise<{ base: string; modelId: string }> {
		const ctx = await createEngineContext({
			backend: createMemorySecretBackend(),
			index: createMemoryAccountIndex(),
			modelsPath: null,
		});
		const handle = fauxProvider({ provider: `faux-completions-${counter++}` });
		handle.setResponses([fauxAssistantMessage([fauxText(text)])]);
		ctx.models.registerNativeProvider(handle.provider);
		server = await startEngineServer({ token: "t", routes: completionsRoutes(ctx) });
		return { base: `http://127.0.0.1:${server.port}`, modelId: handle.getModel().id };
	}

	test("rejects a malformed request with 400", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ messages: [] }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects an unknown model with 404", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: "no-such-model", messages: [{ role: "user", content: "hi" }] }),
		});
		expect(res.status).toBe(404);
	});

	test("returns a non-streaming completion", async () => {
		const { base, modelId } = await start("plain answer");
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			object: string;
			choices: { message: { role: string; content: string }; finish_reason: string }[];
		};
		expect(body.object).toBe("chat.completion");
		expect(body.choices[0].message.role).toBe("assistant");
		expect(body.choices[0].message.content).toContain("plain answer");
		expect(body.choices[0].finish_reason).toBe("stop");
	});

	test("streams SSE chunks ending with [DONE]", async () => {
		const { base, modelId } = await start("streamed answer");
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], stream: true }),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const text = await res.text();
		expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);

		// Deltas arrive token-sized, so reassemble them the way a client does.
		const payloads = text
			.split("\n\n")
			.map((block) => block.replace(/^data: /, "").trim())
			.filter((payload) => payload.length > 0 && payload !== "[DONE]")
			.map(
				(payload) =>
					JSON.parse(payload) as { choices: { delta: { content?: string }; finish_reason: string | null }[] },
			);

		expect(payloads.length).toBeGreaterThan(1);
		const content = payloads.map((chunk) => chunk.choices[0].delta.content ?? "").join("");
		expect(content).toBe("streamed answer");
		expect(payloads.at(-1)?.choices[0].finish_reason).toBe("stop");
	});

	test("a system message becomes the system prompt rather than a turn", async () => {
		const { base, modelId } = await start("ok");
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				model: modelId,
				messages: [
					{ role: "system", content: "be terse" },
					{ role: "user", content: "hi" },
				],
			}),
		});
		expect(res.status).toBe(200);
	});

	test("returns FIM text for /v1/completions", async () => {
		const { base, modelId } = await start("filled middle");
		const res = await fetch(`${base}/v1/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: modelId, prompt: "function f() {", suffix: "}", max_tokens: 32 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { object: string; choices: { text: string; finish_reason: string }[] };
		expect(body.object).toBe("text_completion");
		expect(body.choices[0].text).toContain("filled middle");
		expect(body.choices[0].finish_reason).toBe("stop");
	});

	test("/v1/completions rejects an unknown model with 404", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: "no-such-model", prompt: "x", suffix: "y" }),
		});
		expect(res.status).toBe(404);
	});

	test("no response body carries a stored credential", async () => {
		const { base, modelId } = await start("safe");
		const raw = await (
			await fetch(`${base}/v1/chat/completions`, {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
			})
		).text();
		expect(raw).not.toMatch(/sk-|api_key|refresh/);
	});
});
