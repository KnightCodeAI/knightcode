import { fauxAssistantMessage, fauxText } from "@knightcode/ai";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createGate } from "./fixtures/gate-extension.ts";
import replaceExtension, { replaceState, seenModes, shutdowns } from "./fixtures/replace-extension.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);
beforeEach(() => {
	seenModes.length = 0;
	shutdowns.length = 0;
	replaceState.cancelSwitch = false;
	replaceState.switchTarget = "";
});

const withFixture = () => startServer({ extraExtensions: [{ name: "replace", factory: replaceExtension }] });

test("ctx.newSession replaces the thread for every subscriber and unloads the old one at once", async () => {
	const server = await withFixture();
	const a = await server.connect();
	const b = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	await b.client.request("thread/resume", { threadId: thread.id });
	await a.client.request("turn/start", { threadId: thread.id, text: "/fresh" });
	const replaced = await b.waitFor("thread/replaced");
	expect(replaced.oldThreadId).toBe(thread.id);
	const next = (replaced.thread as { id: string }).id;
	expect(next).not.toBe(thread.id);
	await b.waitFor("thread/status/changed", (p) => p.threadId === thread.id && p.status === "notLoaded");
	expect(shutdowns).toContain("new");
	expect(server.threads.loadedCount()).toBe(1);
	server.faux.setResponses([fauxAssistantMessage([fauxText("hi")])]);
	await a.client.request("turn/start", { threadId: next, text: "hello" });
	await a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === next);
});

test("a session_before_switch cancel changes nothing", async () => {
	const server = await withFixture();
	replaceState.cancelSwitch = true;
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	await a.client.request("turn/start", { threadId: thread.id, text: "/fresh" });
	expect(a.notifications.some((n) => n.method === "thread/replaced")).toBe(false);
	expect(server.threads.get(thread.id).subscribers.size).toBe(1);
});

test("ctx.switchSession to a thread already loaded reuses its session", async () => {
	const server = await withFixture();
	const a = await server.connect();
	const { thread: target } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage([fauxText("saved")])]);
	await a.client.request("turn/start", { threadId: target.id, text: "save me" });
	await a.waitFor("turn/completed");
	const targetSession = server.threads.get(target.id).session;
	replaceState.switchTarget = server.threads.get(target.id).file!;
	const b = await server.connect();
	const { thread: source } = await b.client.request("thread/start", { cwd: server.cwd });
	await b.client.request("turn/start", { threadId: source.id, text: "/goto" });
	const replaced = await b.waitFor("thread/replaced");
	expect((replaced.thread as { id: string }).id).toBe(target.id);
	expect(server.threads.get(target.id).session).toBe(targetSession);
	expect(server.threads.get(target.id).subscribers.size).toBe(2);
	await b.waitFor("thread/status/changed", (p) => p.threadId === source.id && p.status === "notLoaded");
});

test("shutdown waits for a replacement whose target load is parked in an extension", async () => {
	// The first load (the thread itself) passes; the second (the replacement's new session) parks.
	const gate = createGate(1);
	const server = await startServer({
		extraExtensions: [
			{ name: "replace", factory: replaceExtension },
			{ name: "gate", factory: gate.extension },
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const fresh = a.client
		.request("turn/start", { threadId: thread.id, text: "/fresh" })
		.catch((error: unknown) => error);
	await gate.entered;
	const closing = server.threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	await fresh;
	// The parked target and the old thread were both shut down before closeAll resolved.
	expect(gate.events).toEqual(["session_shutdown", "session_shutdown", "closeAll"]);
	expect(server.threads.loadedCount()).toBe(0);
});

test("extensions see ctx.mode desktop for a stdio-mode client and tui for in-process", async () => {
	const server = await withFixture();
	const desktop = await server.connect("desktop");
	await desktop.client.request("thread/start", { cwd: server.cwd });
	const terminal = await server.connect("tui");
	await terminal.client.request("thread/start", { cwd: server.cwd });
	expect(seenModes).toEqual(["desktop", "tui"]);
});

test("command/list returns extension commands, and sendMessage produces an extensionMessage item", async () => {
	const server = await withFixture();
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const { commands } = await a.client.request("command/list", { threadId: thread.id });
	expect(commands.map((c) => c.name)).toEqual(expect.arrayContaining(["fresh", "goto", "note"]));
	server.faux.setResponses([fauxAssistantMessage([fauxText("ack")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "/note" });
	const item = await a.waitFor("item/completed", (p) => (p.item as { type: string }).type === "extensionMessage");
	expect(item.item).toMatchObject({ extension: "note", text: "noted" });
});
