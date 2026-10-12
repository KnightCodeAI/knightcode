import { PROTOCOL_VERSION } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import { AppServerError } from "../../src/app-server/errors.ts";
import { createInProcessClient, createInProcessPair } from "../../src/app-server/in-process.ts";
import { AppServer } from "../../src/app-server/server.ts";

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("malformed initialized params cannot complete the handshake", async () => {
	const pair = createInProcessPair();
	let ready = false;
	const replies: unknown[] = [];
	pair.client.onMessage((message) => replies.push(message));
	new AppServer({
		transport: pair.server,
		version: "0",
		mode: "desktop",
		handlers: {},
		onInitialized: () => {
			ready = true;
		},
	});
	pair.client.send({
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "t", version: "0" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} },
	});
	await tick();
	pair.client.send({ method: "initialized", params: { typo: true } });
	await tick();
	expect(ready).toBe(false);
	expect(replies).toContainEqual({ method: "error", params: { message: "Invalid notification: initialized" } });
	pair.client.close();
});

test("prototype members are not client methods", async () => {
	const client = createInProcessClient({ version: "0", handlers: {} });
	await client.initialize();
	await expect(client.request("__proto__" as "model/list", {})).rejects.toMatchObject({ code: "methodNotFound" });
	client.close();
});

test("structured response errors retain their class and recovery data", async () => {
	const data = { source: "a", destination: "b", recoveryInstructions: ["Choose another destination"] };
	const client = createInProcessClient({
		version: "0",
		handlers: {
			"thread/archive": async () => {
				throw new AppServerError("archiveConflict", "destination exists", data);
			},
			"thread/unarchive": async () => {
				throw new AppServerError("archiveConflict", "destination exists");
			},
		},
	});
	await client.initialize();
	const error: unknown = await client.request("thread/archive", { threadId: "t" }).catch((failure: unknown) => failure);
	expect(error).toBeInstanceOf(AppServerError);
	expect(error).toMatchObject({ code: "archiveConflict", message: "destination exists", data });
	await expect(client.request("thread/unarchive", { threadId: "t" })).rejects.toMatchObject({
		code: "archiveConflict",
		data: undefined,
	});
	client.close();
});

test("a malformed response to a server request rejects the pending request", async () => {
	const pair = createInProcessPair();
	const sent: { id?: number; method?: string }[] = [];
	pair.client.onMessage((message) => sent.push(message as { id?: number; method?: string }));
	const server = new AppServer({ transport: pair.server, version: "0", mode: "desktop", handlers: {} });
	pair.client.send({
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "t", version: "0" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} },
	});
	await tick();
	pair.client.send({ method: "initialized", params: {} });
	await tick();
	const pending = server.request(
		"item/toolCall/requestApproval",
		{ threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {} },
		new AbortController().signal,
	);
	await tick();
	const id = sent.find((message) => message.method === "item/toolCall/requestApproval")!.id!;
	// JSON-RPC libraries add a field the envelope schema does not allow.
	const reply = { jsonrpc: "2.0", id, result: { decision: "accept" } };
	pair.client.send(reply);
	await expect(pending).rejects.toMatchObject({ code: "invalidParams", message: "Malformed response" });
	pair.client.close();
});
