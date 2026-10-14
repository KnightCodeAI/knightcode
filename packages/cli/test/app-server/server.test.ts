import { PassThrough } from "node:stream";
import { arch, homedir } from "node:os";
import { fauxAssistantMessage, fauxText } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);
import { AppServerError } from "../../src/app-server/errors.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { AppServer, commitOnSend, type Handlers } from "../../src/app-server/server.ts";
import { createStdioTransport } from "../../src/app-server/stdio.ts";

const handlers: Handlers = {
	"model/list": async () => ({ models: [], default: null }),
	"thread/read": async ({ threadId }) => {
		throw new AppServerError("threadNotFound", `unknown thread: ${threadId}`);
	},
};

test("a method before initialize answers notInitialized", async () => {
	const client = createInProcessClient({ handlers, version: "0.0.0" });
	await expect(client.request("model/list", {})).rejects.toMatchObject({ code: "notInitialized" });
});

test("after the handshake, methods dispatch, params are validated, unknown methods are refused", async () => {
	const client = createInProcessClient({ handlers, version: "1.2.3" });
	expect(await client.initialize()).toEqual({
		serverInfo: { name: "knightcode", version: "1.2.3" },
		platform: { os: process.platform, arch: arch(), homeDir: homedir() },
	});
	expect(await client.request("model/list", {})).toEqual({ models: [], default: null });
	await expect(client.request("thread/read", { threadId: "x" })).rejects.toMatchObject({ code: "threadNotFound" });
	await expect(client.request("thread/read", { threadId: 7 } as never)).rejects.toMatchObject({
		code: "invalidParams",
	});
	await expect(client.request("thread/start", { cwd: "/p" })).rejects.toMatchObject({ code: "methodNotFound" });
});

test("server requests round-trip and are rejected with SubscriberGone on close", async () => {
	let connection: AppServer | undefined;
	const client = createInProcessClient({ handlers, version: "0", onInitialized: (c) => (connection = c) });
	client.onRequest("item/toolCall/requestApproval", async () => ({ decision: "accept" }));
	await client.initialize();
	const params = {
		threadId: "t",
		turnId: "u",
		itemId: "i",
		tool: "bash",
		input: {},
		decisions: ["accept" as const, "decline" as const],
	};
	expect(await connection!.request("item/toolCall/requestApproval", params, new AbortController().signal)).toEqual({
		decision: "accept",
	});
	client.onRequest("item/toolCall/requestApproval", () => new Promise(() => {}));
	const pending = connection!.request("item/toolCall/requestApproval", params, new AbortController().signal);
	client.close();
	await expect(pending).rejects.toMatchObject({ name: "SubscriberGone" });
});

test("aborting a server request tells the client it was cancelled", async () => {
	let connection: AppServer | undefined;
	const client = createInProcessClient({ handlers, version: "0", onInitialized: (c) => (connection = c) });
	const seen: string[] = [];
	client.onNotification((method) => seen.push(method));
	client.onRequest("item/toolCall/requestApproval", () => new Promise(() => {}));
	await client.initialize();
	const controller = new AbortController();
	const pending = connection!.request(
		"item/toolCall/requestApproval",
		{ threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {}, decisions: ["accept", "decline"] },
		controller.signal,
	);
	controller.abort();
	await expect(pending).rejects.toThrow();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(seen).toContain("serverRequest/cancelled");
});

test("a request still running when stdin ends is answered, and only then does output close", async () => {
	const input = new PassThrough();
	const written: Array<{ id?: number }> = [];
	const transport = createStdioTransport(input, async (text) => {
		written.push(JSON.parse(text));
	});
	let entered!: () => void;
	const running = new Promise<void>((resolve) => (entered = resolve));
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	let inputEnded!: () => void;
	const ended = new Promise<void>((resolve) => (inputEnded = resolve));
	let closed = false;
	const outputClosed = new Promise<void>((resolve) =>
		transport.onClose(() => {
			closed = true;
			resolve();
		}),
	);
	new AppServer({
		transport,
		mode: "desktop",
		version: "0",
		handlers: {
			"model/list": async () => {
				entered();
				await released;
				return { models: [], default: null };
			},
		},
		onInputEnd: () => inputEnded(),
	});
	const line = (message: unknown) => `${JSON.stringify(message)}\n`;
	input.write(
		line({
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "t", version: "1" }, capabilities: {} },
		}),
	);
	input.write(line({ method: "initialized", params: {} }));
	input.write(line({ id: 2, method: "model/list", params: {} }));
	await running;
	input.end();
	await ended;
	expect(closed).toBe(false);
	release();
	await outputClosed;
	expect(written.map((m) => m.id)).toEqual([1, 2]);
});

test("a committed result is computed when the response is written, and isClosed follows the connection", async () => {
	let committed = false;
	let connection: AppServer | undefined;
	const client = createInProcessClient({
		handlers: {
			...handlers,
			"thread/unsubscribe": async () =>
				commitOnSend(() => {
					committed = true;
					return { status: "notSubscribed" as const };
				}),
		},
		version: "0",
		onInitialized: (c) => (connection = c),
	});
	await client.initialize();
	expect(committed).toBe(false);
	expect(await client.request("thread/unsubscribe", { threadId: "t" })).toEqual({ status: "notSubscribed" });
	expect(committed).toBe(true);
	expect(connection!.isClosed).toBe(false);
	client.close();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(connection!.isClosed).toBe(true);
});

test("initialize reports platform and filters opted-out notifications per connection", async () => {
	const { cwd, faux, connect } = await startServer();
	const quiet = await connect("tui", { optOutNotifications: ["item/agentMessage/delta", "no/such/method"] });
	const loud = await connect();
	expect(quiet.initializeResult.platform).toEqual({ os: process.platform, arch: arch(), homeDir: homedir() });
	const { thread } = await quiet.client.request("thread/start", { cwd });
	await loud.client.request("thread/resume", { threadId: thread.id });
	faux.setResponses([fauxAssistantMessage([fauxText("streamed reply with several words in it")])]);
	await quiet.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await quiet.waitFor("turn/completed");
	await loud.waitFor("turn/completed");
	expect(quiet.notifications.some((n) => n.method === "item/agentMessage/delta")).toBe(false);
	expect(loud.notifications.some((n) => n.method === "item/agentMessage/delta")).toBe(true);
});

test("server/diagnostics reports threads, memory and the final listing counters", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	await a.client.request("thread/start", { cwd });
	const d = await a.client.request("server/diagnostics", {});
	expect(d.loadedThreads).toBe(1);
	expect(d.rssBytes).toBeGreaterThan(0);
	expect(d.uptimeMs).toBeGreaterThanOrEqual(0);
	expect(d.listingFilesOpened).toBe(0);
	expect(d.listingBytesScanned).toBe(0);
});
