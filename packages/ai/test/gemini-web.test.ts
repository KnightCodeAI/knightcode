import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGeminiWebCookieRotation, mergeSessionCookies } from "../src/api/gemini-web-cookies.ts";
import { stream, streamSimple } from "../src/api/gemini-web.ts";
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
	visibleReplyText,
} from "../src/api/gemini-web-tools.ts";
import { builtinProviders } from "../src/providers/all.ts";
import { geminiWebProvider } from "../src/providers/gemini-web.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";
import type { AssistantMessageEvent, Context, Tool } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

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

function replyFrame(text: string, completed: boolean, thinking?: string, modelHash?: string): string {
	const candidate: unknown[] = ["rc_1", [text], null, null, null, null, null, null, [completed ? 2 : 1]];
	if (thinking !== undefined) candidate[37] = [[thinking]];
	const inner: unknown[] = [null, ["c_1", "r_1"], null, null, [candidate]];
	if (modelHash) inner[39] = modelHash;
	const part = [["wrb.fr", null, JSON.stringify(inner), null, null, null, "generic"]];
	const json = JSON.stringify(part);
	return `${json.length + 1}\n${json}\n`;
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
	rotatedPsidts?: string;
}): FakeGemini {
	const calls: FakeGemini["calls"] = [];
	let generated = 0;
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
			return new Response(options.page ?? INIT_PAGE, { status: 200 });
		}
		if (url.includes("StreamGenerate")) {
			if (options.generateStatus && options.generateStatus !== 200) {
				return new Response("nope", { status: options.generateStatus });
			}
			const frames = generated === 0 ? options.frames : (options.laterFrames?.[generated - 1] ?? options.frames);
			generated += 1;
			return new Response(streamBody(frames ?? []), { status: 200 });
		}
		throw new Error(`unexpected request: ${url}`);
	};
	return { fetch: fakeFetch as typeof fetch, calls };
}

async function run(fake: FakeGemini, ctx: Context = context()): Promise<AssistantMessageEvent[]> {
	const model = geminiWebProvider().getModels()[0];
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream(model, normalizeContext(ctx), { apiKey: COOKIE, fetch: fake.fetch })) {
		events.push(event);
	}
	return events;
}

afterEach(() => {
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
		expect(updates).toEqual([
			{ text: "héllo 😀", completed: false },
			{ text: "héllo 😀 world", completed: true },
		]);
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
		expect(readGeminiWebFrame(frame[0])).toEqual({
			text: "Answer",
			thinking: "Checked both cases",
			completed: true,
		});
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
			"text_end",
			"toolcall_start",
			"toolcall_delta",
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

describe("Gemini web provider", () => {
	it("is registered with default and reasoning models and api key auth", () => {
		const provider = builtinProviders().find((candidate) => candidate.id === "gemini-web");
		expect(provider).toBeDefined();
		expect(provider?.name).toBe("Gemini web");
		expect(provider?.auth.apiKey?.name).toBe("Gemini web session cookies");
		expect(provider?.getModels().map((model) => model.id)).toEqual([
			"default",
			"gemini-3.5-flash-lite",
			"gemini-3.8-flash",
			"gemini-3.1-pro",
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
