import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, expect, test } from "vitest";
import { ARCHIVE_DIR } from "../../src/app-server/session-files.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { TURN_END_TYPE, TURN_MARKER_TYPE } from "../../src/extensions/turn-marker.ts";
import type { ExtensionAPI } from "../../src/index.ts";
import { createGate } from "./fixtures/gate-extension.ts";
import { cleanupServers, startServer, waitForLine } from "./harness.ts";

afterEach(cleanupServers);
const isLocked = (file: string) => lockfile.checkSync(file, { realpath: false });
function savedThread(cwd: string, sessionDir: string): { id: string; file: string } {
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 });
	const saved = { id: manager.getSessionId(), file: manager.getSessionFile()! };
	manager.close();
	return saved;
}

test("thread/read on a saved thread writes nothing and returns its turns", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	// No final newline: a reader that repaired it would change the file.
	const before = readFileSync(file, "utf8").replace(/\n$/, "");
	writeFileSync(file, before);
	const a = await connect();
	const read = await a.client.request("thread/read", { threadId: id });
	expect(read.thread.status).toBe("notLoaded");
	expect(read.turns).toHaveLength(1);
	expect(readFileSync(file, "utf8")).toBe(before);
});

test("thread/read works while another process holds the thread", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const holder = spawn(process.execPath, [join(import.meta.dirname, "fixtures/hold-session.ts"), file], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	try {
		await waitForLine(holder.stdout!, "locked");
		const a = await connect();
		expect((await a.client.request("thread/read", { threadId: id })).turns).toHaveLength(1);
	} finally {
		holder.stdin!.end();
		await once(holder, "exit");
	}
});

test("archive moves a thread out of the default list and unarchive brings it back", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/archive", { threadId: id });
	expect((await a.client.request("thread/list", { cwd })).threads.map((t) => t.id)).not.toContain(id);
	expect((await a.client.request("thread/list", { cwd, archived: true })).threads.map((t) => t.id)).toContain(id);
	await a.client.request("thread/unarchive", { threadId: id });
	expect((await a.client.request("thread/list", { cwd })).threads.map((t) => t.id)).toContain(id);
});

test("archiving a loaded thread unloads it, moves the file, and a resume then loads the archived file", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	await a.client.request("thread/archive", { threadId: id });
	expect(threads.loadedCount()).toBe(0);
	expect(existsSync(file)).toBe(false);
	const { thread } = await a.client.request("thread/resume", { threadId: id });
	expect(thread.archived).toBe(true);
	await a.client.request("thread/unarchive", { threadId: id });
	expect(existsSync(file)).toBe(true);
	expect((await a.client.request("thread/resume", { threadId: id })).thread.archived).toBe(false);
});

test("archiving an unloaded thread, then resuming it, loads the archived file", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/archive", { threadId: id });
	const { thread } = await a.client.request("thread/resume", { threadId: id });
	expect(thread.archived).toBe(true);
	expect(threads.loadedCount()).toBe(1);
});

test("an archive that arrives while a resume is loading waits for it, closes it, then moves the file", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({
		extraExtensions: [{ name: "gate", factory: gate.extension }],
	});
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	const resuming = a.client.request("thread/resume", { threadId: id }).then(
		(result) => result.thread.id,
		(error: unknown) => (error as { code?: string }).code,
	);
	// The resume holds an open manager on `file` and is parked in an extension factory.
	await gate.entered;
	// Called directly so the transition reserves the id in this same step, before the gate opens.
	const archiving = threads.archive(id, true);
	gate.open();
	await archiving;
	// The resume either answered before the archive closed its thread, or found it closed.
	expect([id, "threadNotFound"]).toContain(await resuming);
	expect(gate.events).toEqual(["session_shutdown"]);
	expect(threads.loadedCount()).toBe(0);
	expect(existsSync(file)).toBe(false);
	const moved = join(sessionDir, ARCHIVE_DIR, basename(file));
	expect(existsSync(moved)).toBe(true);
	expect(isLocked(file)).toBe(false);
	expect(isLocked(moved)).toBe(false);
});

test("a resume racing an archive loads the archived file once and creates nothing at the old path", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	const archiving = a.client.request("thread/archive", { threadId: id });
	const resuming = a.client.request("thread/resume", { threadId: id });
	await Promise.all([archiving, resuming]);
	expect(existsSync(file)).toBe(false);
	expect(threads.get(id).file).toContain("archived");
});

test("thread/fork at an unknown item creates no file", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const before = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"));
	const a = await connect();
	await expect(a.client.request("thread/fork", { threadId: id, atItemId: "missing" })).rejects.toMatchObject({
		code: "invalidParams",
	});
	expect(readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))).toEqual(before);
});

test("a transcript left with two names by an interrupted archive is reported with both paths, and nothing changes", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const content = readFileSync(file, "utf8");
	// The crash window of §5.8: link() to the archive succeeded, unlink() of the source never ran.
	mkdirSync(join(sessionDir, ARCHIVE_DIR), { recursive: true });
	const second = join(sessionDir, ARCHIVE_DIR, basename(file));
	linkSync(file, second);
	const a = await connect();
	const error = await a.client.request("thread/resume", { threadId: id }).catch((e: unknown) => e);
	expect(error).toMatchObject({ code: "archiveConflict", data: { reason: "duplicateLinks" } });
	expect(new Set((error as { data: { paths: string[] } }).data.paths)).toEqual(new Set([file, second]));
	expect(threads.loadedCount()).toBe(0);
	expect(readFileSync(file, "utf8")).toBe(content);
	expect(isLocked(file)).toBe(false);
});

test("a resume of a fork whose load is still running joins that load", async () => {
	const gate = createGate();
	const started: string[] = [];
	const counter = (knightcode: ExtensionAPI) => {
		knightcode.on("session_start", (_event, ctx) => {
			started.push(ctx.sessionManager.getSessionId());
		});
	};
	const { cwd, sessionDir, threads, connect } = await startServer({
		extraExtensions: [
			{ name: "gate", factory: gate.extension },
			{ name: "counter", factory: counter },
		],
	});
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	const b = await connect();
	// The source is not loaded, so the fork's load is the first, and it parks at the gate with its file written.
	const forking = a.client.request("thread/fork", { threadId: id });
	await gate.entered;
	const listed = await a.client.request("thread/list", { cwd });
	const forkId = listed.threads.map((t) => t.id).find((t) => t !== id)!;
	const resuming = b.client.request("thread/resume", { threadId: forkId });
	gate.open();
	const [{ thread }] = await Promise.all([forking, resuming]);
	expect(thread.id).toBe(forkId);
	expect(started.filter((s) => s === forkId)).toHaveLength(1);
	expect(threads.loadedCount()).toBe(1);
	expect(threads.get(forkId).subscribers.size).toBe(2);
});

test("an archive of a fork whose load is still running waits for it", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({
		extraExtensions: [{ name: "gate", factory: gate.extension }],
	});
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	const forking = a.client.request("thread/fork", { threadId: id }).catch((error: unknown) => error);
	await gate.entered;
	const forkId = (await a.client.request("thread/list", { cwd })).threads.map((t) => t.id).find((t) => t !== id)!;
	const forkFile = (await threads.files.find(forkId))!;
	// Called directly so the transition reserves the id before the gate opens.
	const archiving = threads.archive(forkId, true);
	gate.open();
	await archiving;
	await forking;
	expect(threads.loadedCount()).toBe(0);
	expect(existsSync(forkFile)).toBe(false);
	expect(existsSync(join(sessionDir, ARCHIVE_DIR, basename(forkFile)))).toBe(true);
	expect(isLocked(forkFile)).toBe(false);
});

test("shutdown waits for a thread/fork whose load is parked in an extension", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({
		extraExtensions: [{ name: "gate", factory: gate.extension }],
	});
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	// The source is not loaded, so the fork's own load is the only one, and it parks at the gate.
	const forking = a.client.request("thread/fork", { threadId: id }).catch((error: unknown) => error);
	await gate.entered;
	const closing = threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	expect(gate.events).toEqual(["session_shutdown", "closeAll"]);
	expect(await forking).toMatchObject({ code: "shuttingDown" });
	expect(threads.loadedCount()).toBe(0);
});

test("thread/list with a shared session dir filters by cwd, and a renamed file is found by its header id", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const other = mkdtempSync(join(tmpdir(), "knightcode-as-other-"));
	const mine = savedThread(cwd, sessionDir);
	savedThread(other, sessionDir);
	const a = await connect();
	expect((await a.client.request("thread/list", { cwd })).threads.map((t) => t.id)).toEqual([mine.id]);
	renameSync(mine.file, join(sessionDir, "imported.jsonl"));
	expect((await a.client.request("thread/read", { threadId: mine.id })).turns).toHaveLength(1);
	rmSync(other, { recursive: true, force: true });
});

test("thread/resume pages turns and says where the next page starts", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const manager = SessionManager.create(cwd, sessionDir);
	for (let i = 0; i < 51; i++) {
		manager.appendCustomEntry(TURN_MARKER_TYPE);
		manager.appendMessage({ role: "user", content: [{ type: "text", text: `turn ${i}` }], timestamp: i });
		manager.appendCustomEntry(TURN_END_TYPE, { status: "completed" });
	}
	const id = manager.getSessionId();
	manager.close();
	const a = await connect();
	const first = await a.client.request("thread/resume", { threadId: id });
	expect(first.turns).toHaveLength(50);
	expect(first.nextCursor).toEqual(expect.any(String));
	expect(first.nextCursor).not.toBe("50");
	const rest = await a.client.request("thread/read", { threadId: id, cursor: first.nextCursor });
	expect(rest.turns).toHaveLength(1);
	expect(rest.nextCursor).toBeUndefined();
});
