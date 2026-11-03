import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { stream } from "../src/api/gemini-web.ts";
import { isGeminiWebErrorReply } from "../src/api/gemini-web-protocol.ts";
import { buildGeminiWebPrompt } from "../src/api/gemini-web-tools.ts";
import { clearGeminiWebCookieRotation } from "../src/api/gemini-web-cookies.ts";
import { geminiWebProvider } from "../src/providers/gemini-web.ts";
import { cleanupSessionResources } from "../src/session-resources.ts";
import type { AssistantMessageEvent } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";

const failure = "I'm having a hard time fulfilling your request. Can I help you with something else instead?";
const malformed =
	'<tool_call>{"name":"edit","arguments":{"path":"a.ts","edits":[{"oldText":"a","newText":"alt="""}]}}</tool_call>';
const valid =
	'<tool_call>{"name":"edit","arguments":{"path":"a.ts","edits":[{"oldText":"a","newText":"b"}]}}</tool_call>';
const model = geminiWebProvider().getModels()[0];
const context = () =>
	normalizeContext({
		systemPrompt: "Respect permissions. Do not modify private files.",
		tools: [
			{
				name: "edit",
				description: "Edit",
				parameters: Type.Object({
					path: Type.String(),
					edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
				}),
			},
		],
		messages: [{ role: "user", content: "Fix the bug in a.ts", timestamp: 1 }],
	});
function fake(replies: string[]) {
	const prompts: string[] = [];
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const url = String(input);
		if (url.includes("RotateCookies")) return new Response("");
		if (new URL(url).pathname === "/app") return new Response('"SNlM0e":"fixture"');
		if (!url.includes("StreamGenerate")) throw new Error("Unexpected URL");
		prompts.push(JSON.parse(JSON.parse(new URLSearchParams(String(init?.body)).get("f.req")!)[1])[0][0]);
		const reply = replies[prompts.length - 1];
		if (reply === undefined) throw new Error("Unexpected additional generation");
		const candidate = ["rc1", [reply], null, null, null, null, null, null, [2]];
		const frame = JSON.stringify([["wrb.fr", null, JSON.stringify([null, ["c1", "r1"], null, null, [candidate]])]]);
		return new Response(`)]}'\n${frame.length + 1}\n${frame}\n`);
	};
	return { fetch, prompts };
}
afterEach(() => {
	cleanupSessionResources();
	clearGeminiWebCookieRotation();
});

async function run(replies: string[]) {
	const transport = fake(replies);
	const events: AssistantMessageEvent[] = [];
	const response = stream(model, context(), { apiKey: "fixture", fetch: transport.fetch });
	for await (const event of response) events.push(event);
	return { ...transport, events, message: await response.result() };
}

describe("Gemini web observed failure regressions", () => {
	it.each([failure, failure.replace("I'm", "I’m"), failure.toUpperCase().replaceAll(" ", "\n")])(
		"recovers the hard-time stock reply without exposing or replaying it: %s",
		async (reply) => {
			expect(isGeminiWebErrorReply(reply)).toBe(true);
			expect(isGeminiWebErrorReply(reply.slice(0, 24), true)).toBe(true);
			const { message, events, prompts } = await run([reply, valid]);
			expect(message.stopReason).toBe("toolUse");
			expect(prompts).toHaveLength(2);
			expect(prompts[1]).toContain("Respect permissions");
			expect(
				events
					.filter((event) => event.type === "text_delta")
					.map((event) => event.delta)
					.join(""),
			).not.toContain(reply.trim());
			const ctx = context();
			ctx.messages.push({ ...message, stopReason: "stop", content: [{ type: "text", text: reply }] });
			expect(buildGeminiWebPrompt(ctx)).not.toContain(reply);
		},
	);

	it.each([
		`Google said: ${failure}`,
		`\`${failure}\``,
		`\`\`\`text\n${failure}\n\`\`\``,
		`${failure} The build log explains why.`,
	])("does not mistake quoted examples or explanations for stock errors: %s", (text) => {
		expect(isGeminiWebErrorReply(text)).toBe(false);
	});

	it("stops after one repeated hard-time failure, never reporting a successful answer", async () => {
		const { message, prompts } = await run([failure, failure]);
		expect(message.stopReason).toBe("error");
		expect(isRetryableAssistantError(message)).toBe(false);
		expect(prompts).toHaveLength(2);
	});

	it("corrects malformed tool JSON once before any call can be executed", async () => {
		const { message, events, prompts } = await run([malformed, valid]);
		expect(message.stopReason).toBe("toolUse");
		expect(message.content.filter((block) => block.type === "toolCall")).toMatchObject([
			{ name: "edit", arguments: { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] } },
		]);
		expect(events.filter((event) => event.type === "toolcall_end")).toHaveLength(1);
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain("None of the calls from that reply were executed");
		expect(prompts[1]).toContain("small, unique edit replacements");
	});

	it.each([
		{ replies: [malformed, malformed] },
		{ replies: [malformed, "No changes."] },
		{ replies: [failure, malformed] },
		{ replies: [malformed, failure] },
	])("shares one bounded recovery budget for invalid JSON and stock failures ($replies)", async ({ replies }) => {
		const { message, events, prompts } = await run(replies);
		expect(message.stopReason).toBe("error");
		expect(isRetryableAssistantError(message)).toBe(false);
		expect(events.some((event) => event.type === "toolcall_end")).toBe(false);
		expect(prompts).toHaveLength(2);
	});

	it("replays saved malformed calls as unexecuted proposals without changing local history", async () => {
		const { message } = await run([valid]);
		const call = message.content.find((block) => block.type === "toolCall")!;
		call.argumentsError = "Tool call JSON could not be parsed";
		call.arguments = {};
		const ctx = context();
		ctx.messages.push(message, {
			role: "toolResult",
			toolCallId: call.id,
			toolName: "edit",
			isError: true,
			content: [{ type: "text", text: "Validation rejected the arguments; nothing executed." }],
			timestamp: 2,
		});
		const before = JSON.stringify(ctx);
		const prompt = buildGeminiWebPrompt(ctx);
		expect(prompt).toContain("Proposed edit call rejected for invalid arguments before execution");
		expect(prompt).toContain("Validation rejected the arguments; nothing executed.");
		expect(prompt).not.toContain('<tool_call>{"name":"edit","arguments":{}}</tool_call>');
		expect(JSON.stringify(ctx)).toBe(before);
	});

	it("does not authorize the valid part of a malformed batch before correction completes", async () => {
		const { message, events } = await run([`${valid}\n${malformed}`, valid]);
		expect(message.content.filter((block) => block.type === "toolCall")).toHaveLength(1);
		expect(events.filter((event) => event.type === "toolcall_end")).toHaveLength(1);
	});
});
