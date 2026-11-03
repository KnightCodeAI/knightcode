import type { Message } from "@knightcode/ai";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGeminiWebCookieRotation } from "../../ai/src/api/gemini-web-cookies.ts";
import { stream as streamGeminiWeb } from "../../ai/src/api/gemini-web.ts";
import { geminiWebProvider } from "../../ai/src/providers/gemini-web.ts";
import { cleanupSessionResources } from "../../ai/src/session-resources.ts";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentEvent, AgentTool } from "../src/types.ts";

// Mock only Google's transport. The real provider parser, agent loop, validation and file-edit tool all run.
function frame(text: string, completed: boolean): string {
	const candidate = ["rc1", [text], null, null, null, null, null, null, [completed ? 2 : 1]];
	const inner = [null, ["c1", "r1"], null, null, [candidate]];
	const json = JSON.stringify([["wrb.fr", null, JSON.stringify(inner)]]);
	return `${json.length + 1}\n${json}\n`;
}

const roots: string[] = [];
afterEach(() => {
	cleanupSessionResources();
	clearGeminiWebCookieRotation();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.each([
	"I seem to be encountering an error. Can I try something else for you?",
	"I encountered an error doing what you asked. Could you try again?",
	"Sorry, something went wrong. Please try your request again.",
	"I'm having a hard time fulfilling your request. Can I help you with something else instead?",
])("Gemini web file edits through the agent (%s)", (failure) => {
	it.each([
		{ mode: "copy-paste advice", blocked: false, requests: 3 },
		{ mode: "withdrawn draft", blocked: false, requests: 3 },
		{ mode: "rewritten draft", blocked: false, requests: 2 },
		{ mode: "copy-paste advice", blocked: true, requests: 3 },
		{ mode: "failure after an edit", blocked: false, requests: 3 },
		{ mode: "repeated failure after an edit", blocked: false, requests: 3 },
		{ mode: "multi-round failure", blocked: false, requests: 12 },
		{ mode: "long replay", blocked: false, requests: 2 },
		{ mode: "long replay", blocked: true, requests: 2 },
		{ mode: "malformed tool", blocked: false, requests: 3 },
		{ mode: "malformed tool", blocked: true, requests: 3 },
	])(
		"handles $mode (permission blocked: $blocked) without executing stale calls",
		async ({ mode, blocked, requests }) => {
			const root = mkdtempSync(join(tmpdir(), "kc-gemini-edit-"));
			roots.push(root);
			const file = join(root, "app.css");
			writeFileSync(file, "html { scroll-behavior: smooth; }\n");
			const schema = Type.Object({ path: Type.Literal("app.css"), oldText: Type.String(), newText: Type.String() });
			const executeEdit = vi.fn(async (_id: string, args: { path: "app.css"; oldText: string; newText: string }) => {
				const before = readFileSync(file, "utf8");
				expect(before).toContain(args.oldText);
				writeFileSync(file, before.replace(args.oldText, args.newText));
				return { content: [{ type: "text" as const, text: "Edited app.css" }], details: undefined };
			});
			const edit: AgentTool<typeof schema, undefined> = {
				name: "edit",
				label: "Edit",
				description: "Edit a file",
				parameters: schema,
				execute: executeEdit,
			};
			const writeSchema = Type.Object({ path: Type.String(), content: Type.String() });
			const executeStale = vi.fn(async () => {
				throw new Error("A draft-only write must never run");
			});
			const write: AgentTool<typeof writeSchema, undefined> = {
				name: "write",
				label: "Write",
				description: "Write a file",
				parameters: writeSchema,
				execute: executeStale,
			};
			const readSchema = Type.Object({ path: Type.Literal("app.css") });
			const read: AgentTool<typeof readSchema, undefined> = {
				name: "read",
				label: "Read",
				description: "Read a file",
				parameters: readSchema,
				execute: async () => ({ content: [{ type: "text", text: readFileSync(file, "utf8") }], details: undefined }),
			};
			const editReply =
				'<tool_call>{"name":"edit","arguments":{"path":"app.css","oldText":"smooth","newText":"auto"}}</tool_call>';
			const draft = '<tool_call>{"name":"write","arguments":{"path":"app.css","content":"stale draft"}}</tool_call>';
			const failed = mode === "repeated failure after an edit";
			const reads = mode === "multi-round failure" ? 8 : 0;
			const responses: string[][] = [];
			switch (mode) {
				case "copy-paste advice":
					responses.push(
						[frame("Directly apply this replacement.\n```css\nhtml { scroll-behavior: auto; }\n```", true)],
						[frame(editReply, true)],
					);
					break;
				case "withdrawn draft":
					responses.push(
						[frame(draft, false), frame("I encountered an error doing what you asked. Could you try again?", true)],
						[frame(editReply, true)],
					);
					break;
				case "rewritten draft":
					responses.push([frame(draft, false), frame(editReply, true)]);
					break;
				case "long replay":
					responses.push([frame(editReply, true)]);
					break;
				case "malformed tool":
					responses.push(
						[frame('<tool_call>{"name":"edit","arguments":{"newText":"alt="""}}</tool_call>', true)],
						[frame(editReply, true)],
					);
					break;
				case "failure after an edit":
				case "repeated failure after an edit":
					responses.push([frame(editReply, true)], [frame(failure, true)]);
					break;
				case "multi-round failure":
					for (let index = 0; index < reads; index++)
						responses.push([frame('<tool_call>{"name":"read","arguments":{"path":"app.css"}}</tool_call>', true)]);
					responses.push([frame(failure, true)], [frame(editReply, true)], [frame(failure, true)]);
					break;
				default:
					throw new Error(`Unknown scenario: ${mode}`);
			}
			responses.push([
				frame(failed ? failure : blocked ? "No permission to edit; no files changed." : "Applied the changes.", true),
			]);
			let generated = 0;
			const prompts: string[] = [];
			const fakeFetch: typeof fetch = async (input, init) => {
				const url = String(input);
				if (url.includes("RotateCookies")) return new Response("");
				if (new URL(url).pathname === "/app")
					return new Response('"SNlM0e":"fixture-token","cfb2h":"fixture-build","FdrFJe":"1"');
				if (!url.includes("StreamGenerate")) throw new Error(`Unexpected URL: ${url}`);
				prompts.push(JSON.parse(JSON.parse(new URLSearchParams(String(init?.body)).get("f.req")!)[1])[0][0]);
				const frames = responses[generated++];
				if (!frames) throw new Error("Unexpected extra Gemini generation");
				return new Response(`)]}'\n${frames.join("")}`);
			};
			const model = geminiWebProvider().getModels()[0];
			const history: Message[] = [];
			if (mode === "long replay") {
				for (let index = 0; index < 24; index++) {
					const id = `prior-read-${index}`;
					history.push(
						{
							role: "assistant",
							api: model.api,
							provider: model.provider,
							model: model.id,
							content: [{ type: "toolCall", id, name: "read", arguments: { path: "app.css" } }],
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 0,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
							stopReason: "toolUse",
							timestamp: index * 2,
						},
						{
							role: "toolResult",
							toolCallId: id,
							toolName: "read",
							isError: false,
							content: [{ type: "text", text: `${"old".repeat(2_000)} OLD_MIDDLE_${index} ${"source".repeat(1_000)}` }],
							timestamp: index * 2 + 1,
						},
					);
				}
			}
			const events: AgentEvent[] = [];
			const agent = agentLoop(
				[{ role: "user", content: "fix them in the code", timestamp: 1 }],
				{ messages: history, tools: [read, edit, write] },
				{
					model,
					convertToLlm: (messages) =>
						messages.filter(
							(m) => m.role === "system" || m.role === "user" || m.role === "assistant" || m.role === "toolResult",
						) as Message[],
					beforeToolCall: async () => (blocked ? { block: true, reason: "Permission denied" } : undefined),
				},
				undefined,
				(_model, context, options) =>
					streamGeminiWeb(model, context, {
						...options,
						apiKey: "fixture-psid",
						fetch: fakeFetch,
						sessionId: "file-edit-regression",
					}),
			);
			for await (const event of agent) events.push(event);
			const messages = await agent.result();
			expect(
				messages
					.filter((m) => m.role === "assistant")
					.filter((m) => m.stopReason === "error")
					.map((m) => m.errorMessage),
			).toEqual(failed ? [expect.stringContaining("after one recovery attempt")] : []);
			expect(executeStale).not.toHaveBeenCalled();
			expect(executeEdit).toHaveBeenCalledTimes(blocked ? 0 : 1);
			expect(readFileSync(file, "utf8")).toBe(`html { scroll-behavior: ${blocked ? "smooth" : "auto"}; }\n`);
			expect(events.filter((event) => event.type === "tool_execution_start").map((event) => event.toolName)).toEqual([
				...new Array<string>(reads).fill("read"),
				"edit",
			]);
			expect(messages.filter((m) => m.role === "toolResult")).toHaveLength(reads + 1);
			expect(generated).toBe(requests);
			if (mode === "long replay") {
				expect(prompts[0]).toContain("characters omitted from this older tool output");
				expect(prompts[0]).not.toContain(" OLD_MIDDLE_0 ");
				expect(prompts[0]).toContain(" OLD_MIDDLE_23 ");
			}
		},
	);
});
