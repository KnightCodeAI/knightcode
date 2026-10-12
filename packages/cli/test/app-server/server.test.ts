import { PassThrough } from "node:stream";
import { PROTOCOL_VERSION } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
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

test("a wrong protocolVersion answers versionMismatch and closes", async () => {
	const client = createInProcessClient({ handlers, version: "0.0.0" });
	await expect(
		client.request("initialize", {
			clientInfo: { name: "t", version: "1" },
			protocolVersion: PROTOCOL_VERSION + 1,
			capabilities: {},
		}),
	).rejects.toMatchObject({ code: "versionMismatch" });
	await expect(client.request("model/list", {})).rejects.toThrow("closed");
});

test("after the handshake, methods dispatch, params are validated, unknown methods are refused", async () => {
	const client = createInProcessClient({ handlers, version: "1.2.3" });
	expect(await client.initialize()).toEqual({
		serverInfo: { name: "knightcode", version: "1.2.3" },
		protocolVersion: PROTOCOL_VERSION,
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
	const params = { threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {} };
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
		{ threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {} },
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
			params: { clientInfo: { name: "t", version: "1" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} },
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
					return {};
				}),
		},
		version: "0",
		onInitialized: (c) => (connection = c),
	});
	await client.initialize();
	expect(committed).toBe(false);
	expect(await client.request("thread/unsubscribe", { threadId: "t" })).toEqual({});
	expect(committed).toBe(true);
	expect(connection!.isClosed).toBe(false);
	client.close();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(connection!.isClosed).toBe(true);
});
