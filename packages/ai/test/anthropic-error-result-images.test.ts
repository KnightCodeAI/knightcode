import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import type { Context, Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model = (baseUrl: string): Model<"anthropic-messages"> => ({
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "test-anthropic",
	baseUrl,
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8000,
});

function contextWithToolResult(isError: boolean): Context {
	return {
		messages: [
			{ role: "user", content: "Look at the screen", timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "toolu_1", name: "screenshot", arguments: {} }],
				api: "anthropic-messages",
				provider: "test-anthropic",
				model: "claude-sonnet-4-5",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 2,
			},
			{
				role: "toolResult",
				toolCallId: "toolu_1",
				toolName: "screenshot",
				content: [
					{ type: "text", text: "capture failed" },
					{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				],
				isError,
				timestamp: 3,
			},
		],
	};
}

async function captureToolResultContent(context: Context): Promise<unknown> {
	let body: { messages: Array<{ content: unknown }> } | undefined;
	const server = createServer(async (request: IncomingMessage, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	try {
		const events = streamAnthropic(model(`http://127.0.0.1:${port}`), normalizeContext(context), {
			apiKey: "test-key",
			cacheRetention: "none",
		});
		for await (const event of events) {
			if (event.type === "done" || event.type === "error") break;
		}
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
	const last = body?.messages.at(-1);
	const blocks = last?.content as Array<{ type: string; content: unknown }>;
	return blocks.find((block) => block.type === "tool_result")?.content;
}

describe("Anthropic tool results with images", () => {
	// The API rejects an error tool result that carries anything but text with a 400.
	it("replaces images in an error tool result with a text note", async () => {
		const content = await captureToolResultContent(contextWithToolResult(true));
		expect(JSON.stringify(content)).toContain("image omitted");
		expect(JSON.stringify(content)).not.toContain('"type":"image"');
	});

	it("keeps images in a successful tool result", async () => {
		const content = (await captureToolResultContent(contextWithToolResult(false))) as Array<{ type: string }>;
		expect(content.map((block) => block.type)).toEqual(["text", "image"]);
	});
});
