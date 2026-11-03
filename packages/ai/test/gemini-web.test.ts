import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGeminiWebCookieRotation, mergeSessionCookies } from "../src/api/gemini-web-cookies.ts";
import { prepareGeminiWebConversation } from "../src/api/gemini-web-conversation.ts";
import { stream, streamSimple, type GeminiWebOptions } from "../src/api/gemini-web.ts";
import { cleanupSessionResources } from "../src/session-resources.ts";
import {
	buildGeminiWebRequest,
	cleanTransientText,
	GeminiWebFrameParser,
	parseGeminiWebCookies,
	parseGeminiWebInitPage,
	readGeminiWebFrame,
} from "../src/api/gemini-web-protocol.ts";
import {
	buildGeminiWebPrompt,
	declinedGeminiWebTools,
	parseGeminiWebReply,
	readGeminiWebToolCallProgress,
	visibleReplyText,
} from "../src/api/gemini-web-tools.ts";
import { builtinProviders } from "../src/providers/all.ts";
import { geminiWebProvider } from "../src/providers/gemini-web.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";
import type { AssistantMessage, AssistantMessageEvent, Context, Tool } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";

// Gemini web is an unofficial protocol, so nothing here talks to Google. The fixtures mirror the shapes read by
// the reference clients; a live check needs real cookies and is left to the user.

const INIT_PAGE = '..."SNlM0e":"token-123","cfb2h":"boq_build","FdrFJe":"-4242","TuX5cc":"en"...';
const COOKIE = "__Secure-1PSID=psid-value; __Secure-1PSIDTS=psidts-value";

const readTool: Tool = {
	name: "read",
	description: "Read a file",
	parameters: Type.Object({ path: Type.String() }),
};

function context(overrides: Partial<Context> = {}): Context {
	return {
		systemPrompt: "You are a coding agent.",
		messages: [{ role: "user", content: "open the readme", timestamp: 1 }],
		tools: [readTool],
		...overrides,
	};
}

function replyFrame(
	text: string,
	completed: boolean,
	thinking?: string,
	modelHash?: string,
	ids = ["c_1", "r_1", "rc_1"],
): string {
	const candidate: unknown[] = [ids[2], [text], null, null, null, null, null, null, [completed ? 2 : 1]];
	if (thinking !== undefined) candidate[37] = [[thinking]];
	const inner: unknown[] = [null, ids.slice(0, 2), null, null, [candidate]];
	if (modelHash) inner[39] = modelHash;
	const part = [["wrb.fr", null, JSON.stringify(inner), null, null, null, "generic"]];
	const json = JSON.stringify(part);
	return `${json.length + 1}\n${json}\n`;
}

function metadataFrame(token: string): string {
	const inner = new Array<unknown>(26).fill(null);
	inner[25] = token;
	const json = JSON.stringify([["wrb.fr", null, JSON.stringify(inner)]]);
	return `${json.length + 1}\n${json}\n`;
}

function errorFrame(code: number): string {
	const json = JSON.stringify([["wrb.fr", null, null, null, null, [null, null, [[null, [code]]]]]]);
	return `${json.length + 1}\n${json}\n`;
}

function generateRequests(fake: FakeGemini): { prompt: string; metadata: unknown[]; inner: unknown[] }[] {
	return fake.calls
		.filter((call) => call.url.includes("StreamGenerate"))
		.map((call) => {
			const body = new URLSearchParams(String(call.init?.body));
			const inner = JSON.parse(JSON.parse(body.get("f.req")!)[1]) as unknown[];
			return { prompt: (inner[0] as string[])[0], metadata: inner[2] as unknown[], inner };
		});
}

function doneMessage(events: AssistantMessageEvent[]): AssistantMessage {
	const done = events.at(-1);
	if (done?.type !== "done") throw new Error(`expected done: ${JSON.stringify(done)}`);
	return done.message;
}

function streamBody(frames: string[], chunkSize = 11): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(`)]}'\n\n${frames.join("")}`);
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.slice(offset, offset + chunkSize));
			offset += chunkSize;
		},
	});
}

interface FakeGemini {
	fetch: typeof fetch;
	calls: { url: string; init?: RequestInit }[];
}

function fakeGemini(options: {
	page?: string;
	frames?: string[];
	laterFrames?: string[][];
	generateStatus?: number;
	generateStatuses?: number[];
	laterPages?: string[];
	rotatedPsidts?: string;
}): FakeGemini {
	const calls: FakeGemini["calls"] = [];
	let generated = 0;
	let loadedPages = 0;
	const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		calls.push({ url, init });
		if (url.startsWith("https://accounts.google.com/RotateCookies")) {
			const headers = new Headers();
			if (options.rotatedPsidts) {
				headers.append("set-cookie", `__Secure-1PSIDTS=${options.rotatedPsidts}; Path=/; Secure; HttpOnly`);
			}
			return new Response("", { status: 200, headers });
		}
		if (url.startsWith("https://gemini.google.com/app")) {
			const page = loadedPages === 0 ? options.page : (options.laterPages?.[loadedPages - 1] ?? options.page);
			loadedPages += 1;
			return new Response(page ?? INIT_PAGE, { status: 200 });
		}
		if (url.includes("StreamGenerate")) {
			const status = options.generateStatuses?.[generated] ?? options.generateStatus ?? 200;
			const frames = generated === 0 ? options.frames : (options.laterFrames?.[generated - 1] ?? options.frames);
			generated += 1;
			if (status !== 200) return new Response("nope", { status });
			return new Response(streamBody(frames ?? []), { status: 200 });
		}
		throw new Error(`unexpected request: ${url}`);
	};
	return { fetch: fakeFetch as typeof fetch, calls };
}

async function run(
	fake: FakeGemini,
	ctx: Context = context(),
	options: Partial<GeminiWebOptions> = {},
): Promise<AssistantMessageEvent[]> {
	const model = geminiWebProvider().getModels()[0];
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream(model, normalizeContext(ctx), { apiKey: COOKIE, fetch: fake.fetch, ...options })) {
		events.push(event);
	}
	return events;
}

afterEach(() => {
	cleanupSessionResources();
	clearGeminiWebCookieRotation();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("Gemini web cookies", () => {
	it("accepts a bare __Secure-1PSID value", () => {
		expect(parseGeminiWebCookies("  g.a000abc  ")).toBe("__Secure-1PSID=g.a000abc");
	});

	it("keeps only the session cookies from a pasted cookie header", () => {
		const header = "NID=1; __Secure-1PSID=a; SAPISID=secret; __Secure-1PSIDTS=b; __Secure-1PSIDCC=c; HSID=x";
		expect(parseGeminiWebCookies(header)).toBe("__Secure-1PSID=a; __Secure-1PSIDTS=b; __Secure-1PSIDCC=c");
	});

	it("applies a rotated session cookie and ignores the rest of the jar", () => {
		expect(
			mergeSessionCookies(COOKIE, [
				"NID=1; Path=/",
				"__Secure-1PSIDTS=rotated-ts; Path=/; Secure; HttpOnly",
				"__Secure-1PSIDCC=cc; Path=/; Secure",
			]),
		).toBe("__Secure-1PSID=psid-value; __Secure-1PSIDTS=rotated-ts; __Secure-1PSIDCC=cc");
	});

	it("rejects empty input and headers without the session cookie", () => {
		expect(() => parseGeminiWebCookies("   ")).toThrow("empty");
		expect(() => parseGeminiWebCookies("NID=1; SID=2")).toThrow("__Secure-1PSID");
	});
});

describe("Gemini web protocol", () => {
	it("reassembles frames split across chunks, including the anti-XSSI prefix", () => {
		const raw = `)]}'\n\n${replyFrame("héllo 😀", false)}${replyFrame("héllo 😀 world", true)}`;
		const parser = new GeminiWebFrameParser();
		const parts: unknown[] = [];
		for (let index = 0; index < raw.length; index += 5) parts.push(...parser.feed(raw.slice(index, index + 5)));

		const updates = parts.map(readGeminiWebFrame);
		expect(updates).toMatchObject([
			{ text: "héllo 😀", completed: false },
			{ text: "héllo 😀 world", completed: true },
		]);
		expect(updates[1]?.conversation?.slice(0, 3)).toEqual(["c_1", "r_1", "rc_1"]);
	});

	it("reads init tokens and treats a page without an access token as rejected cookies", () => {
		expect(parseGeminiWebInitPage(INIT_PAGE)).toEqual({
			accessToken: "token-123",
			buildLabel: "boq_build",
			sessionId: "-4242",
			language: "en",
		});
		expect(parseGeminiWebInitPage("<html>sign in</html>")).toBeUndefined();
	});

	it("builds a temporary-chat streaming request", () => {
		const session = parseGeminiWebInitPage(INIT_PAGE)!;
		const request = buildGeminiWebRequest({ prompt: "hi", session, reqId: 12345, requestUuid: "UUID-1" });

		const url = new URL(request.url);
		expect(url.searchParams.get("bl")).toBe("boq_build");
		expect(url.searchParams.get("f.sid")).toBe("-4242");
		expect(url.searchParams.get("_reqid")).toBe("12345");

		const body = new URLSearchParams(request.body);
		expect(body.get("at")).toBe("token-123");
		const inner = JSON.parse(JSON.parse(body.get("f.req")!)[1]) as unknown[];
		expect(inner).toHaveLength(99);
		expect((inner[0] as unknown[])[0]).toBe("hi");
		expect(inner[7]).toBe(1);
		expect(inner[45]).toBe(1);
		expect(inner[59]).toBe("UUID-1");
		expect(inner[79]).toBeNull();
		expect(inner[80]).toBeNull();
		expect(inner[96]).toBe(0);
		expect(request.headers["x-goog-ext-525005358-jspb"]).toBe('["UUID-1",1]');
		expect(request.headers["x-goog-ext-525001261-jspb"]).toBeUndefined();
	});

	function requestInner(modelId: string, level?: "low" | "medium" | "high"): { inner: unknown[]; header?: unknown[] } {
		const session = parseGeminiWebInitPage(INIT_PAGE)!;
		const request = buildGeminiWebRequest({
			prompt: "hi",
			session,
			reqId: 1,
			requestUuid: "UUID-1",
			modelId,
			thinking: level ? { enabled: true, level } : undefined,
		});
		const body = new URLSearchParams(request.body);
		const header = request.headers["x-goog-ext-525001261-jspb"];
		return {
			inner: JSON.parse(JSON.parse(body.get("f.req")!)[1]) as unknown[],
			header: header ? (JSON.parse(header) as unknown[]) : undefined,
		};
	}

	it("points flash and argon at their web modes and leaves the account default unset", () => {
		const fallback = requestInner("default");
		expect(fallback.inner[79]).toBeNull();
		expect(fallback.inner[96]).toBe(0);
		expect(fallback.header).toBeUndefined();
		expect(requestInner("unknown").header).toBeUndefined();

		const flash = requestInner("gemini-3.8-flash", "low");
		expect(flash.inner[79]).toBe(1);
		expect(flash.inner[96]).toBe(1);
		expect(flash.header?.[4]).toBe("56fdd199312815e2");
		expect(flash.header?.[14]).toBe(1);
		expect(flash.header?.[17]).toEqual(["boq_build"]);

		const argon = requestInner("gemini-4-argon", "high");
		expect(argon.inner[79]).toBe(8);
		expect(argon.header?.[4]).toBe("95a4c0abcba24364");
		expect(argon.header?.[7]).toBe(1);
		expect(argon.header?.[14]).toBe(8);

		expect(requestInner("gemini-3.5-flash-lite").inner[79]).toBe(6);
		expect(requestInner("gemini-3.5-flash-lite").header?.[4]).toBe("8c46e95b1a07cecc");
		expect(requestInner("gemini-3.1-pro").inner[79]).toBe(3);
		expect(requestInner("gemini-3.1-pro").header?.[4]).toBe("e6fa609c3fa255c0");
	});

	it("writes the web menu thinking codes, not a 0-2 scale", () => {
		// low = 1, medium = 4, high = 2. 0 is unset, so the old low=0 mapping selected nothing.
		expect(requestInner("gemini-3.8-flash", "low").inner[80]).toBe(1);
		expect(requestInner("gemini-3.8-flash", "medium").inner[80]).toBe(4);
		expect(requestInner("gemini-4-argon", "high").inner[80]).toBe(2);
		expect(requestInner("gemini-4-argon").inner[80]).toBeNull();
		expect(requestInner("gemini-3.8-flash", "low").header?.[15]).toBe(1);
		expect(requestInner("gemini-3.8-flash", "medium").header?.[15]).toBe(4);
		expect(requestInner("gemini-4-argon", "high").header?.[15]).toBe(2);
		expect(requestInner("gemini-4-argon").header?.[15]).toBeNull();
	});

	it("reads the cumulative thought summary separately from the answer", () => {
		const frame = new GeminiWebFrameParser().feed(`)]}'\n${replyFrame("Answer", true, "Checked both cases")}`);
		expect(readGeminiWebFrame(frame[0])).toMatchObject({
			text: "Answer",
			thinking: "Checked both cases",
			completed: true,
		});
	});

	it("reads a temporary-chat context token even when the frame has no reply candidate", () => {
		const parts = new GeminiWebFrameParser().feed(`)]}'\n${metadataFrame("context-token")}`);
		expect(readGeminiWebFrame(parts[0])).toEqual({
			completed: false,
			conversation: [null, null, null, null, null, null, null, null, null, "context-token"],
		});
	});

	it("preserves model selection without marking a continuation as a model switch", () => {
		const conversation = ["c1", "r1", "rc1", null, null, null, null, null, null, "context-token"];
		const request = buildGeminiWebRequest({
			prompt: "Continue",
			conversation,
			session: parseGeminiWebInitPage(INIT_PAGE)!,
			reqId: 1,
			requestUuid: "UUID",
			modelId: "gemini-4-argon",
		});
		const inner = JSON.parse(JSON.parse(new URLSearchParams(request.body).get("f.req")!)[1]) as unknown[];
		expect(inner[2]).toEqual(conversation);
		expect(inner[45]).toBe(1);
		expect(inner[79]).toBe(8);
		expect(inner[96]).toBe(0);
		expect(JSON.parse(request.headers["x-goog-ext-525001261-jspb"])[4]).toBe("95a4c0abcba24364");
	});

	it("reports server error codes and strips attachment placeholders", () => {
		const errorPart = [["wrb.fr", null, null, null, null, [null, null, [[null, [1037]]]]]][0];
		expect(readGeminiWebFrame(errorPart)).toEqual({ completed: false, errorCode: 1037 });

		const frame = new GeminiWebFrameParser().feed(
			`)]}'\n${replyFrame("see http://googleusercontent.com/image/3\n", true)}`,
		);
		expect(readGeminiWebFrame(frame[0])?.text).toBe("see ");
	});

	it("drops unfinished trailing markup only for transient text", () => {
		expect(cleanTransientText("code\n```")).toBe("code");
		expect(cleanTransientText("snake\\_")).toBe("snake");
		expect(cleanTransientText("plain")).toBe("plain");
	});
});

describe("Gemini web tool emulation", () => {
	it("flattens instructions, tool schemas and the conversation into one prompt", () => {
		const prompt = buildGeminiWebPrompt(
			normalizeContext(
				context({
					messages: [
						{ role: "user", content: "open the readme", timestamp: 1 },
						{
							role: "assistant",
							content: [
								{ type: "text", text: "Reading it." },
								{ type: "toolCall", id: "c1", name: "read", arguments: { path: "README.md" } },
							],
							api: "gemini-web",
							provider: "gemini-web",
							model: "default",
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
							toolCallId: "c1",
							toolName: "read",
							content: [{ type: "text", text: "# Title" }],
							isError: false,
							timestamp: 3,
						},
					],
				}),
			),
		);

		expect(prompt).toContain("<instructions>\nYou are a coding agent.\n</instructions>");
		expect(prompt).toContain('"name":"read"');
		expect(prompt).toContain('"description":"Read a file"');
		expect(prompt).toContain("User: open the readme");
		expect(prompt).toContain(
			'Assistant: Reading it.\n<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>',
		);
		expect(prompt).toContain('<tool_result name="read" id="c1">\n# Title\n</tool_result>');
		expect(prompt.endsWith("Reply as the Assistant to the last message.")).toBe(true);
	});

	it("omits the tool section when there are no tools", () => {
		expect(buildGeminiWebPrompt(normalizeContext(context({ tools: [] })))).not.toContain("<tools>");
	});

	it("tells the model there is no tool-call limit", () => {
		const prompt = buildGeminiWebPrompt(normalizeContext(context()));
		expect(prompt).toContain("There is no tool-call limit");
		expect(prompt).toContain("call write or edit");
		expect(declinedGeminiWebTools("I reached the tool-call limit for this session")).toBe(true);
		expect(declinedGeminiWebTools("maximum tool-call limit (`0 remaining`)")).toBe(true);
		expect(declinedGeminiWebTools("Updated the theme.")).toBe(false);
	});

	it.each([
		"There is no tool-call limit. Tools are still available.",
		"I have not reached the tool-call limit.",
		"I haven't reached the tool-call limit.",
		"We haven’t yet hit the tool-call limit.",
		"The agent hasn't exceeded the tool-call limit.",
		"I wasn’t at the tool-call limit.",
		"Tools are not disabled.",
		"0 remaining errors after the fix.",
		"Here is what a tool-call limit means.",
	])("does not treat an explanation as a tool refusal: %s", (reply) => {
		expect(declinedGeminiWebTools(reply)).toBe(false);
	});

	it("shows text up to the first tool call and holds back a half-written tag", () => {
		expect(visibleReplyText("Let me look.\n<tool_call>{", false)).toBe("Let me look.");
		expect(visibleReplyText("Let me look.\n```xml\n<tool_call>{}", false)).toBe("Let me look.");
		expect(visibleReplyText("a <tool_c", false)).toBe("a ");
		expect(visibleReplyText("a <tool_c", true)).toBe("a <tool_c");
		expect(visibleReplyText("1 < 2 and more", false)).toBe("1 < 2 and more");
	});

	it("parses several tool calls and keeps the leading text", () => {
		let id = 0;
		const parsed = parseGeminiWebReply(
			'Checking both.\n<tool_call>{"name":"read","arguments":{"path":"a"}}</tool_call>\n<tool_call>{"name":"read","arguments":{"path":"b"}}</tool_call>',
			() => `id${++id}`,
		);
		expect(parsed.text).toBe("Checking both.");
		expect(parsed.toolCalls).toEqual([
			{ type: "toolCall", id: "id1", name: "read", arguments: { path: "a" } },
			{ type: "toolCall", id: "id2", name: "read", arguments: { path: "b" } },
		]);
	});

	it("tolerates markdown-escaped tags, code fences and stringified arguments", () => {
		const parsed = parseGeminiWebReply(
			'<tool\\_call>```json\n{"name":"read","arguments":"{\\"path\\":\\"a\\"}"}\n```</tool\\_call>',
			() => "id",
		);
		expect(parsed.toolCalls).toEqual([{ type: "toolCall", id: "id", name: "read", arguments: { path: "a" } }]);
	});

	it("keeps tool-call tags and escaped quotes inside file contents intact", () => {
		const args = { path: "example.ts", content: 'const tag = "</tool_call> <tool_call>";\\nconst slash = "\\\\";' };
		const raw = `<tool_call>${JSON.stringify({ name: "write", arguments: args })}</tool_call>`;
		expect(parseGeminiWebReply(raw, () => "id").toolCalls).toEqual([
			{ type: "toolCall", id: "id", name: "write", arguments: args },
		]);
		expect(readGeminiWebToolCallProgress(raw)).toEqual([{ name: "write", argumentsText: JSON.stringify(args) }]);
	});

	it("reports malformed call JSON as an argument error when the tool name is recoverable", () => {
		const parsed = parseGeminiWebReply('<tool_call>{"name":"read","arguments":{path: a}}</tool_call>', () => "id");
		expect(parsed.toolCalls).toHaveLength(1);
		expect(parsed.toolCalls[0]).toMatchObject({ name: "read", arguments: {} });
		expect(parsed.toolCalls[0].argumentsError).toContain("could not be parsed");
	});

	it("keeps an unreadable block in the text instead of dropping it", () => {
		const parsed = parseGeminiWebReply("ok <tool_call>not json at all</tool_call>", () => "id");
		expect(parsed.toolCalls).toEqual([]);
		expect(parsed.text).toContain("not json at all");
	});

	it("reads a call whose closing tag never arrived", () => {
		const parsed = parseGeminiWebReply('<tool_call>{"name":"read","arguments":{"path":"a"}}', () => "id");
		expect(parsed.toolCalls).toHaveLength(1);
	});
});

describe("Gemini web adapter", () => {
	it("streams text and returns a tool call", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame("Let me look", false),
				replyFrame('Let me look at it.\n<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>', true),
			],
		});
		const events = await run(fake);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_delta",
			"toolcall_start",
			"toolcall_delta",
			"text_end",
			"toolcall_end",
			"done",
		]);
		const done = events.at(-1);
		if (done?.type !== "done") throw new Error("expected done");
		expect(done.reason).toBe("toolUse");
		expect(done.message.content).toEqual([
			{ type: "text", text: "Let me look at it." },
			{ type: "toolCall", id: expect.stringMatching(/^call_/), name: "read", arguments: { path: "README.md" } },
		]);
	});

	it("retries a claimed tool-call limit and executes the tool", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("I reached the tool-call limit for this session, so I could not write the file.", true)],
			laterFrames: [
				[
					replyFrame(
						'<tool_call>{"name":"write","arguments":{"path":"prismatic-theme.json","content":"{}"}}</tool_call>',
						true,
					),
				],
			],
		});
		const events = await run(fake);
		const done = events.at(-1);
		if (done?.type !== "done") throw new Error("expected done");
		expect(done.reason).toBe("toolUse");
		expect(done.message.content).toContainEqual({
			type: "toolCall",
			id: expect.stringMatching(/^call_/),
			name: "write",
			arguments: { path: "prismatic-theme.json", content: "{}" },
		});
		const generates = fake.calls.filter((call) => call.url.includes("StreamGenerate"));
		expect(generates).toHaveLength(2);
		const retryPrompt = JSON.parse(
			JSON.parse(new URLSearchParams(String(generates[1]?.init?.body)).get("f.req")!)[1],
		)[0][0];
		expect(retryPrompt).toContain("There is no tool-call limit. Tools are still available.");
	});

	it("sends the selected model and thinking level, not a prompt instruction", async () => {
		const fake = fakeGemini({ frames: [replyFrame("done", true)] });
		const model = geminiWebProvider()
			.getModels()
			.find((candidate) => candidate.id === "gemini-4-argon");
		if (!model) throw new Error("expected gemini-4-argon");
		const events: AssistantMessageEvent[] = [];
		for await (const event of streamSimple(model, normalizeContext(context()), {
			apiKey: COOKIE,
			fetch: fake.fetch,
			reasoning: "medium",
		})) {
			events.push(event);
		}
		expect(events.at(-1)?.type).toBe("done");

		const generate = fake.calls.find((call) => call.url.includes("StreamGenerate"));
		if (!generate) throw new Error("expected StreamGenerate");
		const inner = JSON.parse(
			JSON.parse(new URLSearchParams(String(generate.init?.body)).get("f.req")!)[1],
		) as unknown[];
		expect(inner[79]).toBe(8);
		expect(inner[80]).toBe(4);
		const header = JSON.parse(
			(generate.init?.headers as Record<string, string>)["x-goog-ext-525001261-jspb"],
		) as unknown[];
		expect(header[4]).toBe("95a4c0abcba24364");
		expect(header[14]).toBe(8);
		expect(header[15]).toBe(4);
		expect(inner[0]).toEqual([expect.stringContaining("open the readme"), 0, null, null, null, null, 0]);
		expect(String((inner[0] as unknown[])[0])).not.toContain("Thinking effort level");
	});

	it("streams a thought summary before the answer", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("", false, "Checking"), replyFrame("Done", true, "Checking both cases")],
		});
		const events = await run(fake);
		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"done",
		]);
		const done = events.at(-1);
		if (done?.type !== "done") throw new Error("expected done");
		expect(done.message.content).toEqual([
			{ type: "thinking", thinking: "Checking both cases" },
			{ type: "text", text: "Done" },
		]);
	});

	it("sends only the session cookies, to Gemini and the cookie-rotation host", async () => {
		const fake = fakeGemini({ frames: [replyFrame("done", true)] });
		await run(fake);

		expect(fake.calls).toHaveLength(3);
		for (const call of fake.calls) {
			expect(["https://gemini.google.com", "https://accounts.google.com"]).toContain(new URL(call.url).origin);
			expect((call.init?.headers as Record<string, string>).Cookie).toBe(COOKIE);
		}
		const generate = fake.calls[2];
		expect(generate.init?.method).toBe("POST");
		expect(generate.init?.headers && (generate.init.headers as Record<string, string>)["User-Agent"]).toContain(
			"Chrome",
		);
		const prompt = JSON.parse(JSON.parse(new URLSearchParams(String(generate.init?.body)).get("f.req")!)[1])[0][0];
		expect(prompt).toContain("open the readme");
	});

	it("reports a rotated session cookie so the caller can save it", async () => {
		const fake = fakeGemini({ frames: [replyFrame("done", true)], rotatedPsidts: "rotated-ts" });
		const updates: string[] = [];
		const model = geminiWebProvider().getModels()[0]!;
		for await (const _event of stream(model, normalizeContext(context()), {
			apiKey: COOKIE,
			fetch: fake.fetch,
			onApiKeyUpdate: (apiKey) => {
				updates.push(apiKey);
			},
		})) {
			// The callback is the assertion.
		}

		expect(updates).toEqual(["__Secure-1PSID=psid-value; __Secure-1PSIDTS=rotated-ts"]);
		const generate = fake.calls.find((call) => call.url.includes("StreamGenerate"));
		expect((generate?.init?.headers as Record<string, string>).Cookie).toContain("rotated-ts");
	});

	it("preserves rotated-cookie notifications through streamSimple", async () => {
		const fake = fakeGemini({ frames: [replyFrame("Done", true)], rotatedPsidts: "fresh-ts" });
		const onApiKeyUpdate = vi.fn();
		const message = await streamSimple(geminiWebProvider().getModels()[0], normalizeContext(context()), {
			apiKey: COOKIE,
			fetch: fake.fetch,
			onApiKeyUpdate,
		}).result();
		expect(message.stopReason).toBe("stop");
		expect(onApiKeyUpdate).toHaveBeenCalledWith("__Secure-1PSID=psid-value; __Secure-1PSIDTS=fresh-ts");
	});

	it("allows long thinking by default and respects an explicit timeout", async () => {
		const timeout = vi.spyOn(AbortSignal, "timeout");
		doneMessage(await run(fakeGemini({ frames: [replyFrame("Done", true)] })));
		expect(timeout).toHaveBeenCalledWith(600_000);
		doneMessage(await run(fakeGemini({ frames: [replyFrame("Done", true)] }), context(), { timeoutMs: 90_000 }));
		expect(timeout).toHaveBeenCalledWith(90_000);
	});

	it("does not automatically repeat a request after its full waiting limit", async () => {
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const fake = fakeGemini({ frames: [replyFrame("Must not finish", true)] });
		const fetch: typeof globalThis.fetch = async (input, init) => {
			if (String(input).includes("StreamGenerate")) {
				deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
				throw deadline.signal.reason;
			}
			return fake.fetch(input, init);
		};
		const last = (await run(fake, context(), { fetch })).at(-1);
		expect(last).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("without automatic repeats") },
		});
		if (last?.type !== "error") throw new Error("expected deadline failure");
		expect(isRetryableAssistantError(last.error)).toBe(false);
	});

	it("does not hide a quota error that arrives as the waiting limit expires", async () => {
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const fake = fakeGemini({ frames: [errorFrame(1037)] });
		const last = (
			await run(fake, context(), {
				onProviderStreamEvent: () => deadline.abort(new DOMException("The operation timed out.", "TimeoutError")),
			})
		).at(-1);
		expect(last).toMatchObject({ type: "error", error: { errorMessage: expect.stringContaining("usage limit") } });
	});

	it("keeps cancellation distinct from the waiting limit and never executes a partial call", async () => {
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"write","arguments":{"path":"stale","content":"draft"}}</tool_call>', false),
			],
		});
		const events = await run(fake, context(), {
			onProviderStreamEvent: () => deadline.abort(new DOMException("The operation timed out.", "TimeoutError")),
		});
		const last = events.at(-1);
		expect(last).toMatchObject({ type: "error", reason: "error" });
		expect(events.some((event) => event.type === "toolcall_end")).toBe(false);
		if (last?.type !== "error") throw new Error("expected deadline failure");
		expect(isRetryableAssistantError(last.error)).toBe(false);
		const user = new AbortController();
		user.abort();
		expect((await run(fake, context(), { signal: user.signal })).at(-1)).toMatchObject({
			type: "error",
			reason: "aborted",
		});
	});

	it("finishes with stop and no tool calls for a plain answer", async () => {
		const events = await run(fakeGemini({ frames: [replyFrame("Hello there", true)] }));
		const done = events.at(-1);
		if (done?.type !== "done") throw new Error("expected done");
		expect(done.reason).toBe("stop");
		expect(done.message.content).toEqual([{ type: "text", text: "Hello there" }]);
	});

	it("discards a reply Google answered with a different model", async () => {
		const model = geminiWebProvider()
			.getModels()
			.find((candidate) => candidate.id === "gemini-4-argon");
		if (!model) throw new Error("expected gemini-4-argon");
		const fake = fakeGemini({ frames: [replyFrame("from lite", true, undefined, "8c46e95b1a07cecc")] });
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream(model, normalizeContext(context()), { apiKey: COOKIE, fetch: fake.fetch })) {
			events.push(event);
		}
		const last = events.at(-1);
		if (last?.type !== "error") throw new Error("expected error");
		expect(last.error.errorMessage).toContain("over its quota");
		expect(
			events.some((event) => event.type === "text_delta" && "delta" in event && event.delta.includes("over its quota")),
		).toBe(true);
		expect(
			events.some((event) => event.type === "text_delta" && "delta" in event && event.delta.includes("from lite")),
		).toBe(false);
	});

	it("keeps a reply when Google names the selected model", async () => {
		const model = geminiWebProvider()
			.getModels()
			.find((candidate) => candidate.id === "gemini-4-argon");
		if (!model) throw new Error("expected gemini-4-argon");
		const fake = fakeGemini({ frames: [replyFrame("from argon", true, undefined, "95a4c0abcba24364")] });
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream(model, normalizeContext(context()), { apiKey: COOKIE, fetch: fake.fetch })) {
			events.push(event);
		}
		const done = events.at(-1);
		if (done?.type !== "done") throw new Error("expected done");
		expect(done.message.content).toEqual([{ type: "text", text: "from argon" }]);
	});

	it("fails with a re-login hint when the cookies are rejected", async () => {
		const events = await run(fakeGemini({ page: "<html>sign in</html>" }));
		const last = events.at(-1);
		if (last?.type !== "error") throw new Error("expected error");
		expect(last.error.errorMessage).toContain("rejected the stored cookies");
	});

	it("fails when the stream ends before the reply is complete", async () => {
		const events = await run(fakeGemini({ frames: [replyFrame("partial", false)] }));
		const last = events.at(-1);
		if (last?.type !== "error") throw new Error("expected error");
		expect(last.error.errorMessage).toContain("before the reply finished");
	});

	it("surfaces server error codes", async () => {
		const part = [["wrb.fr", null, null, null, null, [null, null, [[null, [1037]]]]]];
		const json = JSON.stringify(part);
		const events = await run(fakeGemini({ frames: [`${json.length + 1}\n${json}\n`] }));
		const last = events.at(-1);
		if (last?.type !== "error") throw new Error("expected error");
		expect(last.error.errorMessage).toContain("usage limit");
	});

	it("fails on an HTTP error from the generate endpoint", async () => {
		const events = await run(fakeGemini({ generateStatus: 500 }));
		const last = events.at(-1);
		if (last?.type !== "error") throw new Error("expected error");
		expect(last.error.errorMessage).toContain("HTTP 500");
	});
});

describe("Gemini web generic failure replies", () => {
	const failure = "I seem to be encountering an error. Can I try something else for you?";
	const requestFailure = "Sorry, something went wrong. Please try your request again.";

	it.each([
		failure,
		"I encountered an error doing what you asked. Could you try again?",
		requestFailure,
		`  ${requestFailure.toUpperCase().replaceAll(" ", "\n")}  `,
		`  ${failure.toUpperCase().replaceAll(" ", "\n")}  `,
	])("recovers the exact failure reply in a fresh chat: %s", async (reply) => {
		const fake = fakeGemini({
			frames: [replyFrame(reply, true)],
			laterFrames: [[replyFrame("Recovered answer.", true)]],
		});
		const events = await run(fake, context({ tools: [] }));
		expect(doneMessage(events).content).toEqual([{ type: "text", text: "Recovered answer." }]);
		const requests = generateRequests(fake);
		expect(requests).toHaveLength(2);
		expect(requests[1].metadata.slice(0, 3)).toEqual(["", "", ""]);
		expect(requests[1].prompt).toContain("open the readme");
		expect(requests[1].prompt).toContain("Do not repeat successful operations");
		expect(events.filter((event) => event.type === "start")).toHaveLength(1);
		expect(
			events
				.filter((event) => event.type === "text_delta")
				.map((event) => event.delta)
				.join(""),
		).not.toContain(reply.trim());
	});

	it.each(["error", "aborted", "stock", "request-stock"] as const)(
		"does not replay %s replies as confirmed history",
		async (kind) => {
			const draft = doneMessage(
				await run(
					fakeGemini({
						frames: [
							replyFrame(
								'<tool_call>{"name":"write","arguments":{"path":"NEVER_EXECUTED","content":"draft"}}</tool_call>',
								true,
							),
						],
					}),
				),
			);
			const failed: AssistantMessage = {
				...draft,
				stopReason: kind === "error" || kind === "aborted" ? kind : "stop",
				content:
					kind === "error" || kind === "aborted"
						? draft.content
						: [{ type: "text", text: kind === "request-stock" ? requestFailure : failure }],
			};
			const ctx = context();
			ctx.messages.push(failed, { role: "user", content: "Continue the unfinished task", timestamp: 4 });
			const prompt = buildGeminiWebPrompt(normalizeContext(ctx));
			expect(prompt).not.toContain("NEVER_EXECUTED");
			expect(prompt).not.toContain(failure);
			expect(prompt).not.toContain(requestFailure);
			expect(prompt).toContain("Continue the unfinished task");
			expect(ctx.messages).toContain(failed);
		},
	);

	it.each([failure, requestFailure])("holds back a streaming stock failure until recovery: %s", async (reply) => {
		const fake = fakeGemini({
			frames: [replyFrame(reply.slice(0, 1), false), replyFrame(reply.slice(0, 32), false), replyFrame(reply, true)],
			laterFrames: [[replyFrame("Recovered.", true)]],
		});
		const events = await run(fake);
		expect(doneMessage(events).content).toEqual([{ type: "text", text: "Recovered." }]);
		expect(
			events
				.filter((event) => event.type === "text_delta")
				.map((event) => event.delta)
				.join(""),
		).toBe("Recovered.");
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it.each([
		"I seem to be encountering an error in your CSS; I will inspect it.",
		"Sorry, something went wrong in your CSS; I will inspect it.",
		`${requestFailure} The request failed because the file is missing.`,
	])("releases a held prefix when later text is a normal explanation: %s", async (reply) => {
		const fake = fakeGemini({
			frames: [replyFrame(reply.slice(0, 1), false), replyFrame(reply.slice(0, 30), false), replyFrame(reply, true)],
		});
		const events = await run(fake);
		expect(doneMessage(events).content).toEqual([{ type: "text", text: reply }]);
		expect(
			events
				.filter((event) => event.type === "text_delta")
				.map((event) => event.delta)
				.join(""),
		).toBe(reply);
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it("resumes a saved chat with confirmed results but without legacy failures after restarting", async () => {
		const fake = fakeGemini({
			frames: [replyFrame('<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>', true)],
			laterFrames: [[replyFrame('<tool_call>{"name":"read","arguments":{"path":"next.ts"}}</tool_call>', true)]],
		});
		const ctx = context();
		const sessionId = "resume-legacy-request-failure";
		const first = doneMessage(await run(fake, ctx, { sessionId }));
		const call = first.content.find((block) => block.type === "toolCall")!;
		ctx.messages.push(
			first,
			{
				role: "toolResult",
				toolCallId: call.id,
				toolName: call.name,
				content: [{ type: "text", text: "Verified README contents" }],
				isError: false,
				timestamp: 3,
			},
			{ ...first, content: [], stopReason: "error", errorMessage: "The operation timed out." },
			{ ...first, content: [{ type: "text", text: requestFailure }], stopReason: "stop" },
			{ role: "user", content: "Continue the unfinished task", timestamp: 6 },
		);
		cleanupSessionResources(sessionId);
		expect(doneMessage(await run(fake, ctx, { sessionId })).stopReason).toBe("toolUse");
		const requests = generateRequests(fake);
		expect(requests).toHaveLength(2);
		expect(requests[1].metadata.slice(0, 3)).toEqual(["", "", ""]);
		expect(requests[1].prompt).toContain("<instructions>");
		expect(requests[1].prompt).toContain("Verified README contents");
		expect(requests[1].prompt).toContain("Continue the unfinished task");
		expect(requests[1].prompt).not.toContain(requestFailure);
		expect(requests[1].prompt).not.toContain("The operation timed out.");
		expect(ctx.messages.some((message) => message.role === "assistant" && message.stopReason === "error")).toBe(true);
	});

	it("preserves the selected model, thinking and temporary-chat mode during recovery", async () => {
		const fake = fakeGemini({ frames: [replyFrame(failure, true)], laterFrames: [[replyFrame("Recovered.", true)]] });
		const model = geminiWebProvider()
			.getModels()
			.find((candidate) => candidate.id === "gemini-3.8-flash")!;
		const message = await streamSimple(model, normalizeContext(context()), {
			apiKey: COOKIE,
			fetch: fake.fetch,
			sessionId: "repair-model",
			reasoning: "medium",
		}).result();
		expect(message.stopReason).toBe("stop");
		const requests = generateRequests(fake);
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.inner[45]).toBe(1);
			expect(request.inner[79]).toBe(1);
			expect(request.inner[80]).toBe(4);
			expect(request.inner[96]).toBe(1);
			expect(request.metadata.slice(0, 3)).toEqual(["", "", ""]);
		}
	});

	it("does not execute or retry an incomplete recovery response", async () => {
		const fake = fakeGemini({
			frames: [replyFrame(failure, true)],
			laterFrames: [
				[
					replyFrame(
						'<tool_call>{"name":"write","arguments":{"path":"draft","content":"incomplete"}}</tool_call>',
						false,
					),
				],
			],
		});
		const events = await run(fake);
		expect(events.at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("before the reply finished") },
		});
		expect(events.some((event) => event.type === "toolcall_end")).toBe(false);
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("resumes from confirmed tool results and caches only the repaired conversation", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"read","arguments":{"path":"first"}}</tool_call>', true),
				metadataFrame("failed-context"),
			],
			laterFrames: [
				[replyFrame(failure, true)],
				[
					replyFrame('<tool_call>{"name":"read","arguments":{"path":"next"}}</tool_call>', true, undefined, undefined, [
						"c_repaired",
						"r_repaired",
						"rc_repaired",
					]),
					metadataFrame("repaired-context"),
				],
				[replyFrame("Finished.", true)],
			],
		});
		const ctx = context();
		const first = doneMessage(await run(fake, ctx, { sessionId: "soft-failure" }));
		const call = first.content.find((block) => block.type === "toolCall")!;
		ctx.messages.push(first, {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text: "Confirmed file contents" }],
			isError: false,
			timestamp: 3,
		});
		const repaired = doneMessage(await run(fake, ctx, { sessionId: "soft-failure" }));
		const next = repaired.content.find((block) => block.type === "toolCall")!;
		ctx.messages.push(repaired, {
			role: "toolResult",
			toolCallId: next.id,
			toolName: next.name,
			content: [{ type: "text", text: "Next file contents" }],
			isError: false,
			timestamp: 5,
		});
		expect(doneMessage(await run(fake, ctx, { sessionId: "soft-failure" })).stopReason).toBe("stop");
		const requests = generateRequests(fake);
		expect(requests).toHaveLength(4);
		expect(requests[1].metadata[9]).toBe("failed-context");
		expect(requests[1].prompt).not.toContain("<instructions>");
		expect(requests[2].metadata.slice(0, 3)).toEqual(["", "", ""]);
		expect(requests[2].metadata[9]).toBe("");
		expect(requests[2].prompt).toContain("<instructions>");
		expect(requests[2].prompt).toContain("<tools>");
		expect(requests[2].prompt).toContain("Confirmed file contents");
		expect(requests[2].prompt).not.toContain(failure);
		expect(requests[3].metadata[0]).toBe("c_repaired");
		expect(requests[3].metadata[9]).toBe("repaired-context");
		expect(requests[3].prompt).toContain("Next file contents");
		expect(requests[3].prompt).not.toContain("Confirmed file contents");
	});

	it.each([failure, requestFailure])(
		"surfaces a repeated failure without automatic retries or caching: %s",
		async (reply) => {
			const fake = fakeGemini({
				frames: [replyFrame("First answer.", true)],
				laterFrames: [[replyFrame(reply, true)], [replyFrame(reply, true)], [replyFrame("Recovered later.", true)]],
			});
			const ctx = context();
			ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "persistent-soft-failure" })), {
				role: "user",
				content: "Continue",
				timestamp: 3,
			});
			const last = (await run(fake, ctx, { sessionId: "persistent-soft-failure" })).at(-1);
			expect(last).toMatchObject({
				type: "error",
				error: { errorMessage: expect.stringContaining("after one recovery attempt") },
			});
			if (last?.type !== "error") throw new Error("expected failure");
			expect(isRetryableAssistantError(last.error)).toBe(false);
			expect(generateRequests(fake)).toHaveLength(3);
			ctx.messages.push(last.error, { role: "user", content: "Continue again", timestamp: 5 });
			expect(doneMessage(await run(fake, ctx, { sessionId: "persistent-soft-failure" })).stopReason).toBe("stop");
			expect(generateRequests(fake)[3].metadata[0]).toBe("");
		},
	);

	it.each([failure, requestFailure])("shares the recovery budget with tool correction: %s", async (reply) => {
		const fake = fakeGemini({
			frames: [replyFrame("Tools are disabled", true)],
			laterFrames: [[replyFrame(reply, true)], [replyFrame("Must not be requested", true)]],
		});
		expect((await run(fake)).at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("after one recovery attempt") },
		});
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not stack tool correction after a generic-failure recovery", async () => {
		const fake = fakeGemini({
			frames: [replyFrame(failure, true)],
			laterFrames: [[replyFrame("Tools are disabled", true)], [replyFrame("Must not be requested", true)]],
		});
		expect((await run(fake)).at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("after one recovery attempt") },
		});
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("shares the recovery budget with explicit continuation rejection", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("First answer.", true)],
			laterFrames: [[errorFrame(1050)], [replyFrame(failure, true)], [replyFrame("Must not be requested", true)]],
		});
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "rejected-soft-failure" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		expect((await run(fake, ctx, { sessionId: "rejected-soft-failure" })).at(-1)?.type).toBe("error");
		expect(generateRequests(fake)).toHaveLength(3);
	});

	it.each([429, 500])("propagates HTTP %s from the fresh-chat recovery without another attempt", async (status) => {
		const fake = fakeGemini({ frames: [replyFrame(failure, true)], generateStatuses: [200, status] });
		expect((await run(fake)).at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining(`HTTP ${status}`) },
		});
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not turn a quota response during recovery into another generation", async () => {
		const fake = fakeGemini({ frames: [replyFrame(failure, true)], laterFrames: [[errorFrame(1037)]] });
		expect((await run(fake)).at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("usage limit") },
		});
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not recover a cancelled generic-failure response", async () => {
		const fake = fakeGemini({ frames: [replyFrame(failure, true)] });
		const controller = new AbortController();
		const fetchWithAbort: typeof fetch = async (input, init) => {
			const response = await fake.fetch(input, init);
			if (String(input).includes("StreamGenerate")) controller.abort();
			return response;
		};
		expect((await run(fake, context(), { fetch: fetchWithAbort, signal: controller.signal })).at(-1)).toMatchObject({
			type: "error",
			reason: "aborted",
		});
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it.each([
		`Google sometimes says: ${failure}`,
		`\`${failure}\``,
		`\`\`\`text\n${failure}\n\`\`\``,
		`Google sometimes says: ${requestFailure}`,
		`\`${requestFailure}\``,
		`\`\`\`text\n${requestFailure}\n\`\`\``,
		"I seem to be encountering an error in your CSS; I will inspect it.",
	])("does not retry explanations or quotations: %s", async (reply) => {
		const fake = fakeGemini({ frames: [replyFrame(reply, true)] });
		expect(doneMessage(await run(fake)).content).toEqual([{ type: "text", text: reply }]);
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it("does not classify quoted tool data as another refusal during recovery", async () => {
		const reply =
			'<tool_call>{"name":"write","arguments":{"path":"message.txt","content":"Tools are disabled"}}</tool_call>';
		const fake = fakeGemini({ frames: [replyFrame(failure, true)], laterFrames: [[replyFrame(reply, true)]] });
		expect(doneMessage(await run(fake)).stopReason).toBe("toolUse");
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it.each([failure, requestFailure])("preserves a failure phrase inside tool arguments: %s", async (text) => {
		const reply = `<tool_call>${JSON.stringify({ name: "write", arguments: { path: "error.txt", content: text } })}</tool_call>`;
		const fake = fakeGemini({ frames: [replyFrame(reply, true)] });
		expect(doneMessage(await run(fake)).content).toContainEqual({
			type: "toolCall",
			id: expect.any(String),
			name: "write",
			arguments: { path: "error.txt", content: text },
		});
		expect(generateRequests(fake)).toHaveLength(1);
	});
});

describe("Gemini web session token reuse", () => {
	it("does not reload the app page for each continuation", async () => {
		const fake = fakeGemini({ frames: [replyFrame("Done", true)] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "page-cache" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		doneMessage(await run(fake, ctx, { sessionId: "page-cache" }));
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
		expect(generateRequests(fake)).toHaveLength(2);
		expect(generateRequests(fake)[1].metadata[0]).toBe("c_1");
	});

	it("expires page tokens without extending their lifetime on every turn", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const fake = fakeGemini({ frames: [replyFrame("Done", true)] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "token-expiry" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		clock.mockReturnValue(now + 4 * 60_000);
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "token-expiry" })), {
			role: "user",
			content: "Continue again",
			timestamp: 5,
		});
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
		clock.mockReturnValue(now + 6 * 60_000);
		doneMessage(await run(fake, ctx, { sessionId: "token-expiry" }));
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(2);
		expect(generateRequests(fake)[2].metadata[0]).toBe("c_1");
	});

	it.each([400, 401, 403])("refreshes rejected cached page tokens once after HTTP %s", async (status) => {
		const fake = fakeGemini({
			frames: [replyFrame("Done", true)],
			generateStatuses: [200, status, 200],
			laterPages: [INIT_PAGE.replace("token-123", "fresh-token")],
		});
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "token-refresh" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		const events = await run(fake, ctx, { sessionId: "token-refresh" });
		doneMessage(events);
		expect(events.filter((event) => event.type === "start")).toHaveLength(1);
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(2);
		const requests = fake.calls.filter((call) => call.url.includes("StreamGenerate"));
		expect(requests).toHaveLength(3);
		expect(new URLSearchParams(String(requests[1].init?.body)).get("at")).toBe("token-123");
		expect(new URLSearchParams(String(requests[2].init?.body)).get("at")).toBe("fresh-token");
		expect(generateRequests(fake)[2].metadata[0]).toBe("c_1");
	});

	it("does not loop when refreshing cached page tokens does not fix a rejection", async () => {
		const fake = fakeGemini({ frames: [replyFrame("Done", true)], generateStatuses: [200, 403, 403] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "persistent-rejection" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		expect((await run(fake, ctx, { sessionId: "persistent-rejection" })).at(-1)?.type).toBe("error");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(2);
		expect(generateRequests(fake)).toHaveLength(3);
	});

	it.each([400, 401, 403])("does not refresh a freshly loaded page after HTTP %s", async (status) => {
		const fake = fakeGemini({ generateStatus: status });
		expect((await run(fake, context(), { sessionId: "fresh-rejection" })).at(-1)?.type).toBe("error");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it.each([429, 500])("does not refresh cached page tokens after HTTP %s", async (status) => {
		const fake = fakeGemini({ frames: [replyFrame("Done", true)], generateStatuses: [200, status] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "no-refresh" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		expect((await run(fake, ctx, { sessionId: "no-refresh" })).at(-1)?.type).toBe("error");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not refresh cached page tokens after an incomplete stream", async () => {
		const fake = fakeGemini({ frames: [replyFrame("Done", true)], laterFrames: [[replyFrame("Partial", false)]] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "broken-stream" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		expect((await run(fake, ctx, { sessionId: "broken-stream" })).at(-1)?.type).toBe("error");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not refresh cached page tokens when a rejected request was cancelled", async () => {
		const fake = fakeGemini({ frames: [replyFrame("Done", true)], generateStatuses: [200, 403] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "cancelled-refresh" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		const controller = new AbortController();
		const fetchWithAbort: typeof fetch = async (input, init) => {
			const response = await fake.fetch(input, init);
			if (String(input).includes("StreamGenerate")) controller.abort();
			return response;
		};
		const events = await run(fake, ctx, {
			sessionId: "cancelled-refresh",
			fetch: fetchWithAbort,
			signal: controller.signal,
		});
		expect(events.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("reloads page tokens when the caller's session cookies change", async () => {
		const fake = fakeGemini({ frames: [replyFrame("Done", true)] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "changed-cookie" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		doneMessage(
			await run(fake, ctx, { sessionId: "changed-cookie", apiKey: COOKIE.replace("psidts-value", "changed-ts") }),
		);
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(2);
		expect(generateRequests(fake)[1].metadata[0]).toBe("c_1");
	});
});

describe("Gemini web conversation reuse", () => {
	it("sends only new tool results and user turns while preserving temporary-chat metadata", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>', true),
				metadataFrame("opaque-context"),
			],
			laterFrames: [[replyFrame("Read the file.", true)], [replyFrame("Yes.", true)]],
		});
		const ctx = context();
		const first = doneMessage(await run(fake, ctx, { sessionId: "coding" }));
		const call = first.content.find((block) => block.type === "toolCall");
		if (call?.type !== "toolCall") throw new Error("expected read call");
		ctx.messages.push(first, {
			role: "toolResult",
			toolCallId: call.id,
			toolName: "read",
			content: [{ type: "text", text: "# Unique file contents" }],
			isError: false,
			timestamp: 3,
		});
		const second = doneMessage(await run(fake, ctx, { sessionId: "coding" }));
		ctx.messages.push(second, { role: "user", content: "Is that all?", timestamp: 4 });
		doneMessage(await run(fake, ctx, { sessionId: "coding" }));

		const requests = generateRequests(fake);
		expect(requests).toHaveLength(3);
		expect(requests[0].metadata.slice(0, 3)).toEqual(["", "", ""]);
		expect(requests[1].metadata.slice(0, 3)).toEqual(["c_1", "r_1", "rc_1"]);
		expect(requests[1].metadata[9]).toBe("opaque-context");
		expect(requests[1].prompt).toContain("# Unique file contents");
		expect(requests[1].prompt).not.toContain("open the readme");
		expect(requests[1].prompt).not.toContain("<instructions>");
		expect(requests[1].prompt).not.toContain("<tools>");
		expect(requests[1].prompt.length).toBeLessThan(requests[0].prompt.length);
		expect(requests[2].prompt).toContain("Is that all?");
		expect(requests[2].prompt).not.toContain("Unique file contents");
		for (const request of requests) expect(request.inner[45]).toBe(1);
	});

	it.each([
		"system",
		"tools",
		"edited history",
		"compaction",
		"session",
		"account",
		"thinking",
		"disabled",
		"cleanup",
		"expiry",
	])("starts a fresh chat after %s changes", async (change) => {
		const fake = fakeGemini({ frames: [replyFrame("First answer", true)] });
		const ctx = context();
		const first = doneMessage(await run(fake, ctx, { sessionId: "first" }));
		ctx.messages.push(first, { role: "user", content: "Next question", timestamp: 3 });
		const options: Partial<GeminiWebOptions> = { sessionId: "first" };
		if (change === "system") ctx.systemPrompt = "Different instructions";
		if (change === "tools") ctx.tools = [{ ...readTool, description: "Changed schema" }];
		if (change === "edited history") ctx.messages[0] = { role: "user", content: "A different branch", timestamp: 1 };
		if (change === "compaction")
			ctx.messages = [{ role: "user", content: "Summary of earlier work", timestamp: 1 }, ctx.messages.at(-1)!];
		if (change === "session") options.sessionId = "second";
		if (change === "account") options.apiKey = "__Secure-1PSID=another-account";
		if (change === "thinking") options.thinking = { enabled: true, level: "high" };
		if (change === "disabled") options.cacheRetention = "none";
		if (change === "cleanup") cleanupSessionResources("first");
		if (change === "expiry") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121 * 60_000);
		doneMessage(await run(fake, ctx, options));
		const next = generateRequests(fake)[1];
		expect(next.metadata.slice(0, 3)).toEqual(["", "", ""]);
		expect(next.prompt).toContain("<instructions>");
		expect(next.prompt).toContain("Next question");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(2);
	});

	it("continues after a seventy-minute pause without replaying history or extending page-token lifetime", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const fake = fakeGemini({ frames: [replyFrame("Earlier confirmed work.", true)] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "long-pause" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		clock.mockReturnValue(now + 70 * 60_000);
		doneMessage(await run(fake, ctx, { sessionId: "long-pause" }));
		const next = generateRequests(fake)[1];
		expect(next.metadata[0]).toBe("c_1");
		expect(next.prompt).toContain("Continue");
		expect(next.prompt).not.toContain("Earlier confirmed work");
		expect(next.prompt).not.toContain("<instructions>");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(2);
	});

	it("does not reuse a conversation across model switches", async () => {
		const fake = fakeGemini({ frames: [replyFrame("First answer", true)] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "model-switch" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		const argon = geminiWebProvider()
			.getModels()
			.find((model) => model.id === "gemini-4-argon")!;
		const result = await stream(argon, normalizeContext(ctx), {
			apiKey: COOKIE,
			fetch: fake.fetch,
			sessionId: "model-switch",
		}).result();
		expect(result.stopReason).toBe("stop");
		expect(generateRequests(fake)[1].metadata.slice(0, 3)).toEqual(["", "", ""]);
		expect(generateRequests(fake)[1].inner[96]).toBe(1);
	});

	it("keeps standalone calls stateless", async () => {
		const fake = fakeGemini({ frames: [replyFrame("First answer", true)] });
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx)), { role: "user", content: "Continue", timestamp: 3 });
		doneMessage(await run(fake, ctx));
		expect(generateRequests(fake)[1].metadata.slice(0, 3)).toEqual(["", "", ""]);
		expect(generateRequests(fake)[1].prompt).toContain("open the readme");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(2);
	});

	it("recovers an explicitly rejected continuation once with the full context", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("First answer", true)],
			laterFrames: [[errorFrame(1050)], [replyFrame("Recovered", true)]],
		});
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "expired" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		const events = await run(fake, ctx, { sessionId: "expired" });
		expect(doneMessage(events).content).toEqual([{ type: "text", text: "Recovered" }]);
		expect(events.filter((event) => event.type === "start")).toHaveLength(1);
		const requests = generateRequests(fake);
		expect(requests).toHaveLength(3);
		expect(requests[1].metadata[0]).toBe("c_1");
		expect(requests[2].metadata[0]).toBe("");
		expect(requests[2].prompt).toContain("open the readme");
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
	});

	it("does not retry quota errors or reuse an interrupted response", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("First answer", true)],
			laterFrames: [[errorFrame(1037)], [replyFrame("New answer", true)]],
		});
		const ctx = context();
		ctx.messages.push(doneMessage(await run(fake, ctx, { sessionId: "quota" })), {
			role: "user",
			content: "Continue",
			timestamp: 3,
		});
		expect((await run(fake, ctx, { sessionId: "quota" })).at(-1)?.type).toBe("error");
		expect(generateRequests(fake)).toHaveLength(2);
		expect(fake.calls.filter((call) => new URL(call.url).pathname === "/app")).toHaveLength(1);
		doneMessage(await run(fake, ctx, { sessionId: "quota" }));
		expect(generateRequests(fake)[2].metadata[0]).toBe("");
	});

	it("uses a short continuation for the one tool-refusal retry", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("Tools are disabled", true), metadataFrame("retry-context")],
			laterFrames: [[replyFrame('<tool_call>{"name":"read","arguments":{"path":"a"}}</tool_call>', true)]],
		});
		expect(doneMessage(await run(fake)).stopReason).toBe("toolUse");
		const requests = generateRequests(fake);
		expect(requests).toHaveLength(2);
		expect(requests[1].metadata[9]).toBe("retry-context");
		expect(requests[1].prompt).toContain("Tools are still available");
		expect(requests[1].prompt).not.toContain("open the readme");
	});

	it("falls back to a full prompt when a refusal has no usable conversation metadata", async () => {
		const candidate: unknown[] = [null, ["Tools are disabled"], null, null, null, null, null, null, [2]];
		const json = JSON.stringify([["wrb.fr", null, JSON.stringify([null, null, null, null, [candidate]])]]);
		const fake = fakeGemini({
			frames: [`${json.length + 1}\n${json}\n`],
			laterFrames: [[replyFrame('<tool_call>{"name":"read","arguments":{"path":"a"}}</tool_call>', true)]],
		});
		expect(doneMessage(await run(fake)).stopReason).toBe("toolUse");
		expect(generateRequests(fake)[1].prompt).toContain("open the readme");
		expect(generateRequests(fake)[1].metadata[0]).toBe("");
	});

	it("does not hide a quota error from the single refusal recovery", async () => {
		const fake = fakeGemini({ frames: [replyFrame("Tools are disabled", true)], laterFrames: [[errorFrame(1037)]] });
		const events = await run(fake);
		const last = events.at(-1);
		expect(last?.type).toBe("error");
		if (last?.type === "error") expect(last.error.errorMessage).toContain("usage limit");
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not hide an HTTP usage-limit error from the single refusal recovery", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("Tools are disabled", true)],
			generateStatuses: [200, 429],
		});
		const events = await run(fake, context(), { sessionId: "http-quota-recovery" });
		expect(events.at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("429") },
		});
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("keeps a finished refusal when recovery fails for a non-quota HTTP error", async () => {
		const fake = fakeGemini({
			frames: [replyFrame("Tools are disabled", true)],
			generateStatuses: [200, 500],
		});
		expect(doneMessage(await run(fake)).content).toEqual([{ type: "text", text: "Tools are disabled" }]);
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not let overlapping requests overwrite each other's continuation metadata", async () => {
		const output = doneMessage(await run(fakeGemini({ frames: [replyFrame("Done", true)] })));
		const ctx = normalizeContext(context());
		const input = { context: ctx, cookie: COOKIE, model: "default", sessionId: "concurrent" };
		const first = prepareGeminiWebConversation(input);
		const second = prepareGeminiWebConversation(input);
		second.save(output, ["new-c", "new-r", "new-rc"]);
		first.save(output, ["stale-c", "stale-r", "stale-rc"]);
		const continued = {
			...ctx,
			messages: [...ctx.messages, output, { role: "user" as const, content: "Continue", timestamp: 3 }],
		};
		const next = prepareGeminiWebConversation({ ...input, context: continued });
		expect(next.metadata?.[0]).toBe("new-c");
		cleanupSessionResources("concurrent");
		next.save(output, ["after-disposal-c", "r", "rc"]);
		const afterDisposal = {
			...continued,
			messages: [...continued.messages, output, { role: "user" as const, content: "Again", timestamp: 4 }],
		};
		expect(prepareGeminiWebConversation({ ...input, context: afterDisposal }).metadata).toBeUndefined();
	});

	it("does not cache history that was edited while the request was in flight", async () => {
		const output = doneMessage(await run(fakeGemini({ frames: [replyFrame("Done", true)] })));
		const ctx = normalizeContext(context());
		const input = { context: ctx, cookie: COOKIE, model: "default", sessionId: "mutated" };
		const request = prepareGeminiWebConversation(input);
		const user = ctx.messages.find((message) => message.role === "user")!;
		user.content = "Changed while generating";
		request.save(output, ["c", "r", "rc"]);
		ctx.messages.push(output, { role: "user", content: "Continue", timestamp: 3 });
		expect(prepareGeminiWebConversation(input).metadata).toBeUndefined();
	});

	it("makes no background generation or cookie refresh requests while idle", async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeGemini({ frames: [replyFrame("Done", true)] });
			doneMessage(await run(fake, context(), { sessionId: "idle" }));
			const count = fake.calls.length;
			await vi.advanceTimersByTimeAsync(60 * 60_000);
			expect(fake.calls).toHaveLength(count);
			expect(generateRequests(fake)).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("Gemini web progress", () => {
	it("reads the root tool name when arguments contain a nested name field", () => {
		const args = { name: "file-name", path: "a", arguments: { nested: true } };
		const prefix = `<tool_call>{"arguments":${JSON.stringify(args)},"name":`;
		expect(readGeminiWebToolCallProgress(prefix)).toEqual([]);
		expect(readGeminiWebToolCallProgress(`${prefix}"re`)).toEqual([]);
		expect(readGeminiWebToolCallProgress(`${prefix}"read"}</tool_call>`)).toEqual([
			{ name: "read", argumentsText: JSON.stringify(args) },
		]);
	});

	it("does not mistake nested argument properties for envelope fields", () => {
		expect(
			readGeminiWebToolCallProgress(
				'<tool_call>{"metadata":{"name":"nested","arguments":{"x":1}},"name":"read","arguments":{"path":"a"}}</tool_call>',
			),
		).toEqual([{ name: "read", argumentsText: '{"path":"a"}' }]);
	});

	it.each([false, true])(
		"never reads a nested field as the tool name at any streaming boundary (arguments first: %s)",
		(argumentsFirst) => {
			const args = {
				name: "nested",
				arguments: { name: "nested-again" },
				content: 'Quotes: " and \\, braces: }] <tool_call></tool_call>',
				entries: [null, true, { name: "another" }],
			};
			const envelope = argumentsFirst ? { arguments: args, name: "write" } : { name: "write", arguments: args };
			const raw = JSON.stringify({ metadata: { name: "metadata-name" }, ...envelope });
			for (let end = 0; end <= raw.length; end++) {
				const progress = readGeminiWebToolCallProgress(`<tool_call>${raw.slice(0, end)}`);
				for (const call of progress) expect(call.name).toBe("write");
			}
			expect(readGeminiWebToolCallProgress(`<tool_call>${raw}</tool_call>`)).toEqual([
				{ name: "write", argumentsText: JSON.stringify(args) },
			]);
		},
	);

	it("decodes escaped envelope keys and tool names", () => {
		expect(
			readGeminiWebToolCallProgress(
				'<tool_call>{"na\\u006de":"re\\u0061d","argu\\u006dents":{"path":"a"}}</tool_call>',
			),
		).toEqual([{ name: "read", argumentsText: '{"path":"a"}' }]);
	});

	it("accepts reordered JSON fields without changing the tool's identity", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"read","arguments":{"path":"READ', false),
				replyFrame('<tool_call>{"arguments":{"name":"file-name","path":"README.md"},"name":"read"}</tool_call>', true),
			],
		});
		const message = doneMessage(await run(fake));
		expect(message.content).toContainEqual({
			type: "toolCall",
			id: expect.stringMatching(/^call_/),
			name: "read",
			arguments: { name: "file-name", path: "README.md" },
		});
	});

	it.each([
		"There is no tool-call limit. Tools remain available.",
		"I haven't reached the tool-call limit. Tools remain available.",
		"I haven’t reached the tool-call limit. Tools remain available.",
	])("does not spend a second generation on a normal tool-limit explanation: %s", async (reply) => {
		const fake = fakeGemini({ frames: [replyFrame(reply, true)] });
		expect(doneMessage(await run(fake)).stopReason).toBe("stop");
		expect(generateRequests(fake)).toHaveLength(1);
	});
	it("reads partial tool arguments without leaking markup or executing them", () => {
		expect(readGeminiWebToolCallProgress('<tool_call>{"name":"read","arguments":{"path":"READ')).toEqual([
			{ name: "read", argumentsText: '{"path":"READ' },
		]);
		expect(readGeminiWebToolCallProgress('<tool_call>{"name":"re')).toEqual([]);
		expect(
			readGeminiWebToolCallProgress(
				'<tool_call>{"name":"edit","arguments":{"oldText":"a } b","edits":[{"value":"c"}]}}</tool_call>',
			),
		).toEqual([{ name: "edit", argumentsText: '{"oldText":"a } b","edits":[{"value":"c"}]}' }]);
	});

	it("shows a tool name and partial arguments before the response completes", async () => {
		const release = Promise.withResolvers<void>();
		let sentFirst = false;
		const fake = fakeGemini({});
		const fetchWithGate: typeof fetch = async (input, init) => {
			if (!String(input).includes("StreamGenerate")) return fake.fetch(input, init);
			return new Response(
				new ReadableStream<Uint8Array>({
					async pull(controller) {
						if (!sentFirst) {
							sentFirst = true;
							controller.enqueue(
								new TextEncoder().encode(
									`)]}'\n${replyFrame('<tool_call>{"name":"read","arguments":{"path":"READ', false)}`,
								),
							);
							return;
						}
						await release.promise;
						controller.enqueue(
							new TextEncoder().encode(
								replyFrame('<tool_call>{"name":"read","arguments":{"path":"README.md"}}</tool_call>', true),
							),
						);
						controller.close();
					},
				}),
			);
		};
		let sawPartial = false;
		let ended = 0;
		const model = geminiWebProvider().getModels()[0];
		const response = stream(model, normalizeContext(context()), { apiKey: COOKIE, fetch: fetchWithGate });
		for await (const event of response) {
			if (event.type === "toolcall_delta" && !sawPartial) {
				const call = event.partial.content[event.contentIndex];
				expect(call).toMatchObject({ type: "toolCall", name: "read", arguments: { path: "READ" } });
				expect(ended).toBe(0);
				sawPartial = true;
				release.resolve();
			}
			if (event.type === "toolcall_end") ended++;
		}
		expect(sawPartial).toBe(true);
		expect(ended).toBe(1);
		expect((await response.result()).stopReason).toBe("toolUse");
	});

	it("keeps successive thought summaries instead of dropping non-prefix updates", async () => {
		const events = await run(
			fakeGemini({
				frames: [
					replyFrame("", false, "Checking files"),
					replyFrame("", false, "Preparing edits"),
					replyFrame("Done", true),
				],
			}),
		);
		expect(doneMessage(events).content).toContainEqual({
			type: "thinking",
			thinking: "Checking files\n\nPreparing edits",
		});
	});

	it("does not finish tool calls from an incomplete stream", async () => {
		const events = await run(
			fakeGemini({ frames: [replyFrame('<tool_call>{"name":"read","arguments":{"path":"a"}}</tool_call>', false)] }),
		);
		expect(events.some((event) => event.type === "toolcall_start")).toBe(true);
		expect(events.some((event) => event.type === "toolcall_end")).toBe(false);
		expect(events.at(-1)?.type).toBe("error");
	});
});

describe("Gemini web edit recovery", () => {
	const editTool: Tool = {
		name: "edit",
		description: "Edit a file",
		parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }),
	};
	const advice = "Directly apply the following file replacement.\n```css\nhtml { scroll-behavior: auto; }\n```";
	const edit =
		'<tool_call>{"name":"edit","arguments":{"path":"src/app/globals.css","oldText":"smooth","newText":"auto"}}</tool_call>';

	it.each(["fix them in the code", "you yourself change in the code", "Please edit src/app/globals.css"])(
		"recovers copy-paste advice for an explicit edit request: %s",
		async (request) => {
			const fake = fakeGemini({ frames: [replyFrame(advice, true)], laterFrames: [[replyFrame(edit, true)]] });
			const ctx = context({
				tools: [readTool, editTool],
				messages: [{ role: "user", content: request, timestamp: 1 }],
			});
			const events = await run(fake, ctx);
			expect(doneMessage(events).stopReason).toBe("toolUse");
			expect(doneMessage(events).content).toContainEqual({
				type: "toolCall",
				id: expect.any(String),
				name: "edit",
				arguments: { path: "src/app/globals.css", oldText: "smooth", newText: "auto" },
			});
			const requests = generateRequests(fake);
			expect(requests).toHaveLength(2);
			expect(requests[1].metadata[0]).toBe("c_1");
			expect(requests[1].prompt).toContain("apply");
			expect(events.filter((event) => event.type === "start")).toHaveLength(1);
		},
	);

	it.each([
		"Explain how to fix this code, don't change files.",
		"Show me how to change the code.",
		"Write example code in chat.",
		"How would you fix the code?",
		"Describe the code changes without editing files.",
		"Don't edit the code. Tell me the solution.",
		"Fix this code, but just tell me the solution.",
		"Fix the code in plan mode without modifying files.",
		"Please tell me how to fix the code.",
	])("leaves advice-only requests alone: %s", async (request) => {
		const fake = fakeGemini({ frames: [replyFrame(advice, true)] });
		const ctx = context({ tools: [readTool, editTool], messages: [{ role: "user", content: request, timestamp: 1 }] });
		expect(doneMessage(await run(fake, ctx)).stopReason).toBe("stop");
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it("does not force edits when only read tools are available", async () => {
		const fake = fakeGemini({ frames: [replyFrame(advice, true)] });
		const ctx = context({ messages: [{ role: "user", content: "fix them in the code", timestamp: 1 }] });
		expect(doneMessage(await run(fake, ctx)).stopReason).toBe("stop");
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it("does not retry a normal completion after a successful edit", async () => {
		const fake = fakeGemini({ frames: [replyFrame(edit, true)], laterFrames: [[replyFrame(advice, true)]] });
		const ctx = context({
			tools: [readTool, editTool],
			messages: [{ role: "user", content: "fix them in the code", timestamp: 1 }],
		});
		const first = doneMessage(await run(fake, ctx, { sessionId: "edit-completion" }));
		const call = first.content.find((block) => block.type === "toolCall")!;
		ctx.messages.push(first, {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text: "Edited" }],
			isError: false,
			timestamp: 3,
		});
		expect(doneMessage(await run(fake, ctx, { sessionId: "edit-completion" })).stopReason).toBe("stop");
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("stops after one corrective attempt and reports that no edit was executed", async () => {
		const fake = fakeGemini({ frames: [replyFrame(advice, true)] });
		const ctx = context({
			tools: [readTool, editTool],
			messages: [{ role: "user", content: "fix them in the code", timestamp: 1 }],
		});
		expect((await run(fake, ctx)).at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("No edits were executed") },
		});
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not hide quota failures while recovering delegated edits", async () => {
		const fake = fakeGemini({ frames: [replyFrame(advice, true)], generateStatuses: [200, 429] });
		const ctx = context({
			tools: [readTool, editTool],
			messages: [{ role: "user", content: "fix them in the code", timestamp: 1 }],
		});
		expect((await run(fake, ctx)).at(-1)).toMatchObject({
			type: "error",
			error: { errorMessage: expect.stringContaining("429") },
		});
		expect(generateRequests(fake)).toHaveLength(2);
	});
});

describe("Gemini web rewritten tool calls", () => {
	it("discards withdrawn draft calls instead of throwing or executing them", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"write","arguments":{"path":"stale","content":"draft"}}</tool_call>', false),
				replyFrame("That operation is no longer needed.", true),
			],
		});
		const message = doneMessage(await run(fake, context({ tools: [] })));
		expect(message.stopReason).toBe("stop");
		expect(message.content.filter((block) => block.type === "toolCall")).toEqual([]);
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it("finalizes only the calls present in the completed reply", async () => {
		const read = '<tool_call>{"name":"read","arguments":{"path":"keep"}}</tool_call>';
		const fake = fakeGemini({
			frames: [
				replyFrame(
					`${read}<tool_call>{"name":"write","arguments":{"path":"discard","content":"draft"}}</tool_call>`,
					false,
				),
				replyFrame(read, true),
			],
		});
		const events = await run(fake);
		expect(doneMessage(events).content.filter((block) => block.type === "toolCall")).toEqual([
			{ type: "toolCall", id: expect.any(String), name: "read", arguments: { path: "keep" } },
		]);
		expect(events.filter((event) => event.type === "toolcall_end")).toHaveLength(1);
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it("accepts a tool-name rewrite and never retains the previous arguments", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"write","arguments":{"path":"draft","content":"stale"}}', false),
				replyFrame('<tool_call>{"name":"read","arguments":{"path":"final"}}</tool_call>', true),
			],
		});
		const events = await run(fake);
		expect(doneMessage(events).content.filter((block) => block.type === "toolCall")).toEqual([
			{ type: "toolCall", id: expect.any(String), name: "read", arguments: { path: "final" } },
		]);
	});

	it("recovers a withdrawn call once without carrying stale calls into the retry", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"write","arguments":{"path":"stale","content":"draft"}}</tool_call>', false),
				replyFrame("I encountered an error doing what you asked. Could you try again?", true),
			],
			laterFrames: [[replyFrame('<tool_call>{"name":"read","arguments":{"path":"safe"}}</tool_call>', true)]],
		});
		const events = await run(fake);
		expect(doneMessage(events).content.filter((block) => block.type === "toolCall")).toEqual([
			{ type: "toolCall", id: expect.any(String), name: "read", arguments: { path: "safe" } },
		]);
		expect(events.filter((event) => event.type === "toolcall_end")).toHaveLength(1);
		expect(generateRequests(fake)).toHaveLength(2);
		// Earlier shared partials must still point to tool blocks at the indices announced by toolcall_start.
		for (const event of events)
			if (event.type === "toolcall_start") expect(event.partial.content[event.contentIndex]?.type).toBe("toolCall");
	});

	it("allows intermediate calls to shrink and return with different arguments", async () => {
		const read = '<tool_call>{"name":"read","arguments":{"path":"keep"}}</tool_call>';
		const fake = fakeGemini({
			frames: [
				replyFrame(
					`${read}<tool_call>{"name":"write","arguments":{"path":"stale","content":"draft"}}</tool_call>`,
					false,
				),
				replyFrame(read, false),
				replyFrame(`${read}<tool_call>{"name":"read","arguments":{"path":"final"}}</tool_call>`, true),
			],
		});
		const events = await run(fake);
		expect(
			doneMessage(events)
				.content.filter((block) => block.type === "toolCall")
				.map((call) => ({ name: call.name, arguments: call.arguments })),
		).toEqual([
			{ name: "read", arguments: { path: "keep" } },
			{ name: "read", arguments: { path: "final" } },
		]);
		expect(generateRequests(fake)).toHaveLength(1);
	});

	it("continues from the final reply rather than a withdrawn draft", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"write","arguments":{"path":"stale","content":"draft"}}</tool_call>', false),
				replyFrame("Please try again.", true),
			],
			laterFrames: [
				[replyFrame('<tool_call>{"name":"read","arguments":{"path":"safe"}}</tool_call>', true)],
				[replyFrame("Finished.", true)],
			],
		});
		const ctx = context();
		const first = doneMessage(await run(fake, ctx, { sessionId: "withdrawn-continuation" }));
		const call = first.content.find((block) => block.type === "toolCall")!;
		ctx.messages.push(first, {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text: "Read safe" }],
			isError: false,
			timestamp: 3,
		});
		expect(doneMessage(await run(fake, ctx, { sessionId: "withdrawn-continuation" })).stopReason).toBe("stop");
		const requests = generateRequests(fake);
		expect(requests).toHaveLength(3);
		expect(requests[2].metadata[0]).toBe("c_1");
		expect(requests[2].prompt).toContain("Read safe");
		expect(requests[2].prompt).not.toContain("stale");
	});

	it("does not turn a second withdrawal into an unbounded retry", async () => {
		const fake = fakeGemini({
			frames: [
				replyFrame('<tool_call>{"name":"read","arguments":{"path":"stale"}}</tool_call>', false),
				replyFrame("Please try again.", true),
			],
		});
		const events = await run(fake);
		expect(doneMessage(events).content.some((block) => block.type === "toolCall")).toBe(false);
		expect(events.some((event) => event.type === "toolcall_end")).toBe(false);
		expect(generateRequests(fake)).toHaveLength(2);
	});

	it("does not reuse call ids from unreadable tool blocks", () => {
		let next = 0;
		const parsed = parseGeminiWebReply(
			'<tool_call>unreadable</tool_call><tool_call>{"name":"read","arguments":{"path":"a"}}</tool_call>',
			() => `id-${++next}`,
		);
		expect(parsed.toolCalls[0].id).toBe("id-1");
	});
});

describe("Gemini web provider", () => {
	it("is registered with default and reasoning models and api key auth", () => {
		const provider = builtinProviders().find((candidate) => candidate.id === "gemini-web");
		expect(provider).toBeDefined();
		expect(provider?.name).toBe("Gemini web");
		expect(provider?.auth.apiKey?.name).toBe("Gemini web session cookies");
		expect(provider?.getModels().map((model) => model.id)).toEqual([
			"default",
			"gemini-3.1-pro",
			"gemini-3.5-flash-lite",
			"gemini-3.8-flash",
			"gemini-4-argon",
		]);
	});

	it("supports low, medium, and high thinking levels on gemini-3.8-flash and gemini-4-argon", () => {
		const provider = geminiWebProvider();
		const flash = provider.getModels().find((m) => m.id === "gemini-3.8-flash")!;
		const argon = provider.getModels().find((m) => m.id === "gemini-4-argon")!;
		expect(flash.reasoning).toBe(true);
		expect(argon.reasoning).toBe(true);
		expect(getSupportedThinkingLevels(flash)).toEqual(["low", "medium", "high"]);
		expect(getSupportedThinkingLevels(argon)).toEqual(["low", "medium", "high"]);
	});

	function interaction(answers: string[]) {
		const prompts = [...answers];
		return {
			signal: new AbortController().signal,
			prompt: vi.fn(async () => prompts.shift() ?? ""),
			notify: vi.fn(),
		};
	}

	it("warns, verifies the session and stores only the session cookies", async () => {
		const fake = fakeGemini({});
		vi.stubGlobal("fetch", fake.fetch);
		const flow = interaction(["psid-value", "psidts-value"]);

		const credential = await geminiWebProvider().auth.apiKey!.login!(flow);

		expect(credential).toEqual({ type: "api_key", key: COOKIE });
		expect(flow.notify.mock.calls[0][0]).toMatchObject({ type: "info" });
		expect(flow.notify.mock.calls[0][0].message).toContain("run /logout before uninstalling");
		expect(fake.calls.map((call) => new URL(call.url).pathname)).toEqual(["/RotateCookies", "/app"]);
	});

	it("stores the rotated session cookie from login", async () => {
		const fake = fakeGemini({ rotatedPsidts: "rotated-ts" });
		vi.stubGlobal("fetch", fake.fetch);

		const credential = await geminiWebProvider().auth.apiKey!.login!(interaction(["psid-value", "psidts-value"]));

		expect(credential).toEqual({
			type: "api_key",
			key: "__Secure-1PSID=psid-value; __Secure-1PSIDTS=rotated-ts",
		});
	});

	it("does not store cookies Gemini web rejects", async () => {
		vi.stubGlobal("fetch", fakeGemini({ page: "<html>sign in</html>" }).fetch);
		await expect(geminiWebProvider().auth.apiKey!.login!(interaction(["bad", ""]))).rejects.toThrow(
			"rejected the stored cookies",
		);
	});

	it("resolves cookies from GEMINI_WEB_COOKIES", async () => {
		const resolved = await geminiWebProvider().auth.apiKey!.resolve({
			ctx: { env: async (name) => (name === "GEMINI_WEB_COOKIES" ? COOKIE : undefined), fileExists: async () => false },
			signal: new AbortController().signal,
		});
		expect(resolved?.auth.apiKey).toBe(COOKIE);
	});
});
