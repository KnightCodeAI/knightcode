import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, expect, test, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createGate } from "./fixtures/gate-extension.ts";
import { cleanupServers, startServer, waitForLine } from "./harness.ts";

afterEach(async () => {
	vi.useRealTimers();
	await cleanupServers();
});

const isLocked = (file: string) => lockfile.checkSync(file, { realpath: false });

/** A thread saved to disk and not loaded, as a previous run of the app server or a terminal leaves it. */
function savedThread(cwd: string, sessionDir: string): { id: string; file: string } {
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 });
	const saved = { id: manager.getSessionId(), file: manager.getSessionFile()! };
	manager.close();
	return saved;
}

test("thread/start returns an idle thread on the pinned model and broadcasts thread/started", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const b = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	expect(thread).toMatchObject({
		cwd,
		projectCwd: cwd,
		status: { type: "idle" },
		archived: false,
		approvalMode: "fullAccess",
	});
	expect(thread.model?.id).toBe(faux.getModel().id);
	await b.waitFor("thread/started", (p) => (p.thread as { id: string }).id === thread.id);
});

test("a thread a stdio-mode client starts defaults to ask", async () => {
	const { cwd, connect } = await startServer();
	const desktop = await connect("desktop");
	const { thread } = await desktop.client.request("thread/start", { cwd });
	expect(thread.approvalMode).toBe("ask");
});

test("thread/start refuses a missing cwd, and an unknown model leaves no thread behind", async () => {
	const { cwd, threads, connect } = await startServer();
	const a = await connect();
	await expect(a.client.request("thread/start", { cwd: join(cwd, "missing") })).rejects.toMatchObject({
		code: "invalidParams",
	});
	await expect(
		a.client.request("thread/start", { cwd, model: { provider: "nope", id: "nope" } }),
	).rejects.toMatchObject({
		code: "invalidParams",
	});
	expect(threads.loadedCount()).toBe(0);
});

test("two concurrent resumes of one saved thread share one live session", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	const b = await connect();
	await Promise.all([
		a.client.request("thread/resume", { threadId: id }),
		b.client.request("thread/resume", { threadId: id }),
	]);
	expect(threads.loadedCount()).toBe(1);
	expect(threads.get(id).subscribers.size).toBe(2);
});

test("a resume that arrives while the thread unloads gets a new session after the old one let go", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	const old = threads.get(id).session;
	const unloading = threads.unload(id);
	const resumed = a.client.request("thread/resume", { threadId: id });
	await Promise.all([unloading, resumed]);
	expect(threads.loadedCount()).toBe(1);
	expect(threads.get(id).session).not.toBe(old);
});

test("a connection that closes while its load is in flight is not subscribed", async () => {
	const gate = createGate();
	const { cwd, threads, connect } = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const a = await connect();
	const watcher = await connect();
	const starting = a.client.request("thread/start", { cwd }).catch(() => undefined);
	await gate.entered;
	a.close();
	gate.open();
	await starting;
	const started = await watcher.waitFor("thread/started");
	const id = (started.thread as { id: string }).id;
	expect(threads.get(id).subscribers.size).toBe(0);
});

test("shutdown waits for a thread/start whose load is parked in an extension, and leaves no thread", async () => {
	const gate = createGate();
	const { cwd, threads, connect } = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const a = await connect();
	const starting = a.client.request("thread/start", { cwd }).catch((error: unknown) => error);
	await gate.entered;
	const closing = threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	// The parked thread was disposed before closeAll resolved, so closeAll waited for it.
	expect(gate.events).toEqual(["session_shutdown", "closeAll"]);
	expect(await starting).toMatchObject({ code: "shuttingDown" });
	expect(threads.loadedCount()).toBe(0);
});

test("shutdown with a resume in flight leaves no thread and no lock", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({
		extraExtensions: [{ name: "gate", factory: gate.extension }],
	});
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	const resuming = a.client.request("thread/resume", { threadId: id }).catch((error: unknown) => error);
	await gate.entered;
	const closing = threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	expect(gate.events).toEqual(["session_shutdown", "closeAll"]);
	expect(await resuming).toMatchObject({ code: "shuttingDown" });
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
});

test("a shutdown that starts while a resume is still finding its file waits for that resume", async () => {
	const { cwd, sessionDir, threads } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const order: string[] = [];
	// Started and shut down in one synchronous step: the resume is inside its first await, the file
	// lookup, before any session or lock exists.
	const resuming = threads.ensureLoaded(id, "tui").then(
		() => order.push("loaded"),
		(error: unknown) => order.push((error as { code?: string }).code ?? "error"),
	);
	const closing = threads.closeAll().then(() => order.push("closeAll"));
	await Promise.all([resuming, closing]);
	expect(order).toEqual(["shuttingDown", "closeAll"]);
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
});

test("a thread another process holds answers threadLockedElsewhere", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const holder = spawn(process.execPath, [join(import.meta.dirname, "fixtures/hold-session.ts"), file], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	try {
		await waitForLine(holder.stdout!, "locked");
		const a = await connect();
		await expect(a.client.request("thread/resume", { threadId: id })).rejects.toMatchObject({
			code: "threadLockedElsewhere",
		});
	} finally {
		holder.stdin!.end();
		await once(holder, "exit");
	}
});

test("a session file that fails to load leaves no thread and no lock", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	// The header id fails assertValidSessionId, which runs after the manager has taken the lock.
	const file = join(sessionDir, "2026-10-11T00-00-00-000Z_bad.jsonl");
	writeFileSync(
		file,
		[
			JSON.stringify({ type: "session", version: 3, id: "../escape", timestamp: "2026-10-11T00:00:00.000Z", cwd }),
			JSON.stringify({
				type: "message",
				id: "e1",
				parentId: null,
				timestamp: "2026-10-11T00:00:00.000Z",
				message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
			}),
			"",
		].join("\n"),
	);
	const a = await connect();
	await expect(a.client.request("thread/resume", { threadId: "../escape" })).rejects.toBeDefined();
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
});

test("a thread with no subscriber unloads after the idle timeout and releases its lock", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const { cwd, sessionDir, threads, connect } = await startServer({ idleMs: 60_000 });
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	expect(isLocked(file)).toBe(true);
	await a.client.request("thread/unsubscribe", { threadId: id });
	await vi.advanceTimersByTimeAsync(60_001);
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
	await a.waitFor(
		"thread/status/changed",
		(p) => p.threadId === id && (p.status as { type: string }).type === "notLoaded",
	);
});

test("the idle timer does not unload a busy thread", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const { cwd, sessionDir, threads, connect } = await startServer({ idleMs: 60_000 });
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	let finish!: () => void;
	void threads.get(id).hold(() => new Promise<void>((resolve) => (finish = resolve)));
	await a.client.request("thread/unsubscribe", { threadId: id });
	await vi.advanceTimersByTimeAsync(60_001);
	expect(threads.loadedCount()).toBe(1);
	finish();
	await vi.advanceTimersByTimeAsync(60_001);
	expect(threads.loadedCount()).toBe(0);
});
