import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, linkSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { SessionManager } from "../../src/core/session-manager.ts";
import { afterEach, expect, test, vi } from "vitest";
import { createGate } from "./fixtures/gate-extension.ts";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { cleanupServers, startServer, waitForLine } from "./harness.ts";

afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupServers();
});

type Server = Awaited<ReturnType<typeof startServer>>;

async function archivedThread(server: Server) {
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await a.client.request("thread/archive", { threadId: thread.id }); // also unloads it
	const file = await server.threads.files.find(thread.id);
	a.notifications.length = 0;
	return { a, thread, file: file! };
}

/** Block the next `files.find` call until the returned function is called: delete's preflight lookup. */
function gateNextFind(server: Server): () => void {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	const original = server.threads.files.find.bind(server.threads.files);
	vi.spyOn(server.threads.files, "find").mockImplementationOnce(async (id: string) => {
		await opened;
		return original(id);
	});
	return open;
}

/** Let preflight return immediately; park the lookup inside the closing fence. */
function gateSecondFind(server: Server) {
	let open!: () => void, enter!: () => void;
	const opened = new Promise<void>((r) => {
		open = r;
	});
	const entered = new Promise<void>((r) => {
		enter = r;
	});
	const original = server.threads.files.find.bind(server.threads.files);
	vi.spyOn(server.threads.files, "find")
		.mockImplementationOnce(original)
		.mockImplementationOnce(async (id) => {
			enter();
			await opened;
			return original(id);
		});
	return { entered, open };
}

const notLoadedFor = (c: { notifications: Array<{ method: string; params: Record<string, unknown> }> }, id: string) =>
	c.notifications.some(
		(n) =>
			n.method === "thread/status/changed" &&
			n.params.threadId === id &&
			(n.params.status as { type: string }).type === "notLoaded",
	);

test("an archived thread is deleted and every connection is told", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	const b = await server.connect();
	const open = vi.spyOn(SessionManager, "open");
	await a.client.request("thread/delete", { threadId: thread.id });
	expect(open).not.toHaveBeenCalled();
	await b.waitFor("thread/deleted", (p) => p.threadId === thread.id);
	expect(existsSync(file)).toBe(false);
	expect(existsSync(`${file}.lock-owner`)).toBe(false);
	await expect(a.client.request("thread/read", { threadId: thread.id })).rejects.toMatchObject({
		code: "threadNotFound",
	});
	expect((await a.client.request("thread/list", { archived: true })).threads.some((t) => t.id === thread.id)).toBe(
		false,
	);
});

test("an unarchived thread, running or idle, is refused without being touched", async () => {
	const held = createHeldTurn();
	const { cwd, faux, connect } = await startServer({
		extraExtensions: [{ name: "held-turn", factory: held.extension }],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("finished normally")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	try {
		await held.entered;
		await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({
			code: "threadNotArchived",
		});
	} finally {
		held.release();
	}
	expect(((await a.waitFor("turn/completed")).turn as { status: string }).status).toBe("completed");
	await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({
		code: "threadNotArchived",
	});
	expect(notLoadedFor(a, thread.id)).toBe(false);
	expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
});

test("a turn that starts while delete looks up the file makes delete refuse; the run and subscription survive", async () => {
	const held = createHeldTurn();
	const server = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	const { a, thread } = await archivedThread(server);
	await a.client.request("thread/resume", { threadId: thread.id }); // loaded again, archived
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("finished normally")]),
	]);
	const openFind = gateNextFind(server);
	const deleted = a.client.request("thread/delete", { threadId: thread.id }); // parked in its preflight lookup
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	try {
		await held.entered;
		openFind();
		await expect(deleted).rejects.toMatchObject({ code: "turnInProgress" });
	} finally {
		held.release();
	}
	expect(((await a.waitFor("turn/completed")).turn as { status: string }).status).toBe("completed");
	expect(server.threads.loadedCount()).toBe(1);
	expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
});

test("an unarchive that completes while delete looks up the file makes delete refuse; the file stays", async () => {
	const server = await startServer();
	const { a, thread } = await archivedThread(server);
	const openFind = gateNextFind(server);
	const deleted = a.client.request("thread/delete", { threadId: thread.id }); // preflight sees the archived path
	await a.client.request("thread/unarchive", { threadId: thread.id }); // its own lookups are not gated
	openFind();
	await expect(deleted).rejects.toMatchObject({ code: "threadNotArchived" });
	const file = await server.threads.files.find(thread.id);
	expect(file && existsSync(file)).toBe(true);
	expect((await a.client.request("thread/read", { threadId: thread.id })).thread.archived).toBe(false);
});

test("a delete that arrives while a resume of the same thread is loading waits for it, then deletes", async () => {
	const gate = createGate(1); // let thread/start's load through, park the resume's
	const server = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const { a, thread, file } = await archivedThread(server);
	const resumed = a.client.request("thread/resume", { threadId: thread.id });
	const outcome = resumed.then(
		() => null,
		(error: unknown) => error,
	);
	await gate.entered;
	const deleted = a.client.request("thread/delete", { threadId: thread.id });
	gate.open();
	await deleted;
	expect(await outcome).toMatchObject({ code: "threadNotFound" });
	expect(existsSync(file)).toBe(false);
});

test("another process holding the file: threadLockedElsewhere, file kept", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	const holder = spawn(process.execPath, [join(import.meta.dirname, "fixtures/hold-session.ts"), file], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	try {
		await waitForLine(holder.stdout!, "locked");
		await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({
			code: "threadLockedElsewhere",
		});
		expect(existsSync(file)).toBe(true);
	} finally {
		holder.stdin!.end();
		await once(holder, "exit");
	}
});

test("inside-fence archived refusal restores the loaded and subscribed thread untouched", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	await a.client.request("thread/resume", { threadId: thread.id });
	const live = server.threads.get(thread.id);
	const gate = gateSecondFind(server);
	const moved = join(dirname(dirname(file)), basename(file));
	const deleted = a.client.request("thread/delete", { threadId: thread.id }).then(
		() => null,
		(error: unknown) => error,
	);
	try {
		await gate.entered;
		expect(server.threads.loadedCount()).toBe(0); // synchronous fence removed it, before lookup's await
		// External publication completed before the second lookup. The refusal must not dispose the old thread.
		renameSync(file, moved);
		server.threads.files.remember(thread.id, moved);
		gate.open();
		expect(await deleted).toMatchObject({ code: "threadNotArchived" });
		expect(server.threads.get(thread.id)).toBe(live);
		expect(live.state).toBe("ready");
		expect(live.subscribers.size).toBe(1);
		expect(notLoadedFor(a, thread.id)).toBe(false);
		expect(existsSync(moved)).toBe(true);
	} finally {
		gate.open();
		if (existsSync(moved)) {
			renameSync(moved, file);
			server.threads.files.remember(thread.id, file);
		}
	}
	expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
});

test("a start arriving after the fence waits and cannot run on a deleted thread", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	await a.client.request("thread/resume", { threadId: thread.id });
	const gate = gateSecondFind(server);
	const deleted = a.client.request("thread/delete", { threadId: thread.id });
	void deleted.catch(() => {});
	try {
		await gate.entered;
		expect(server.threads.loadedCount()).toBe(0);
		const start = a.client.request("turn/start", { threadId: thread.id, text: "too late" });
		const outcome = start.then(
			() => null,
			(error: unknown) => error,
		);
		gate.open();
		await deleted;
		expect(await outcome).toMatchObject({ code: "threadNotFound" });
		expect(existsSync(file)).toBe(false);
		expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	} finally {
		gate.open();
	}
});

test("a joined start becomes busy as loading finishes: delete refuses inside its fence and restores subscribers", async () => {
	const load = createGate(1);
	const held = createHeldTurn();
	const server = await startServer({
		extraExtensions: [
			{ name: "gate", factory: load.extension },
			{ name: "held-turn", factory: held.extension },
		],
	});
	const { a, thread, file } = await archivedThread(server);
	const resumed = a.client.request("thread/resume", { threadId: thread.id });
	void resumed.catch(() => {});
	await load.entered;
	let joined!: () => void;
	const joinEntered = new Promise<void>((r) => {
		joined = r;
	});
	const originalEnsure = server.threads.ensureLoaded.bind(server.threads);
	vi.spyOn(server.threads, "ensureLoaded").mockImplementationOnce((...args) => {
		const pending = originalEnsure(...args);
		joined();
		return pending;
	});
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	const start = a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	void start.catch(() => {});
	await joinEntered;
	let found!: () => void;
	const preflight = new Promise<void>((r) => {
		found = r;
	});
	const originalFind = server.threads.files.find.bind(server.threads.files);
	vi.spyOn(server.threads.files, "find").mockImplementationOnce(async (id) => {
		const result = await originalFind(id);
		found();
		return result;
	});
	const deleted = a.client.request("thread/delete", { threadId: thread.id }).then(
		() => null,
		(error: unknown) => error,
	);
	try {
		await preflight;
		await new Promise<void>((r) => setImmediate(r)); // load is still gated; delete is waiting on it
		load.open();
		expect(await deleted).toMatchObject({ code: "turnInProgress" });
		await resumed;
		await start;
		await held.entered;
		const live = server.threads.get(thread.id);
		expect(live.subscribers.size).toBe(1);
		expect(live.state).toBe("ready");
		expect(existsSync(file)).toBe(true);
		expect(notLoadedFor(a, thread.id)).toBe(false);
		held.release();
		await a.waitFor("turn/completed");
		expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
	} finally {
		load.open();
		held.release();
	}
});

test("unsubscribe reports whether this connection was subscribed", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	const b = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
	expect(await b.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "notSubscribed" });
});

test("a hard-linked transcript is refused without reading it through SessionManager.open or changing it", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	const before = readFileSync(file, "utf8");
	linkSync(file, `${file}.other.jsonl`);
	const open = vi.spyOn(SessionManager, "open");
	await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({
		code: "archiveConflict",
		data: { reason: "duplicateLinks" },
	});
	expect(readFileSync(file, "utf8")).toBe(before);
	expect(open).not.toHaveBeenCalled();
});

// Making unlink fail portably needs a read-only directory, which neither Windows nor root honours.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"an unlink failure keeps the file and releases the lock",
	async () => {
		const server = await startServer();
		const { a, thread, file } = await archivedThread(server);
		chmodSync(dirname(file), 0o500);
		try {
			await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({
				code: "internal",
			});
			expect(existsSync(file)).toBe(true);
		} finally {
			chmodSync(dirname(file), 0o700);
		}
		await a.client.request("thread/delete", { threadId: thread.id }); // the lock was released: a retry succeeds
		expect(existsSync(file)).toBe(false);
	},
);
