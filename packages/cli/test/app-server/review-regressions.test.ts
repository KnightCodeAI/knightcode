import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";
import { AppServerClient } from "../../src/app-server/client.ts";
import { createInProcessPair } from "../../src/app-server/in-process.ts";
import { AppServer, commitOnSend } from "../../src/app-server/server.ts";

function saved(cwd: string, dir: string) {
	const manager = SessionManager.create(cwd, dir);
	manager.appendMessage({ role: "user", content: "saved", timestamp: 0 });
	const result = { id: manager.getSessionId(), file: manager.getSessionFile()! };
	manager.close();
	return result;
}
afterEach(cleanupServers);

test("shutdown settles an unfinished request once and never commits its late result", async () => {
	const pair = createInProcessPair();
	let enter!: () => void;
	let open!: () => void;
	let commits = 0;
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const server = new AppServer({
		transport: pair.server,
		mode: "desktop",
		version: "test",
		handlers: {
			"model/list": async () => {
				enter();
				await gate;
				return commitOnSend(() => {
					commits++;
					return { models: [], default: null };
				});
			},
		},
	});
	const client = new AppServerClient(pair.client);
	await client.initialize();
	const response = client.request("model/list", {}).catch((error: unknown) => error);
	await entered;
	server.endInput();
	try {
		server.settleUnfinishedRequests();
		expect(await response).toMatchObject({ code: "shuttingDown" });
	} finally {
		open();
		client.close();
	}
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	expect(commits).toBe(0);
});

test.each([true, false])(
	"archive=%s refuses another same-process owner without invalidating its binding",
	async (archived) => {
		const { cwd, sessionDir, connect } = await startServer();
		const { id, file } = saved(cwd, sessionDir);
		const a = await connect();
		if (!archived) await a.client.request("thread/archive", { threadId: id });
		const source = archived ? file : join(sessionDir, "archived", basename(file));
		await a.client.request("thread/resume", { threadId: id });
		const independent = SessionManager.open(source);
		try {
			await expect(
				a.client.request(archived ? "thread/archive" : "thread/unarchive", { threadId: id }),
			).rejects.toMatchObject({ code: "threadLockedElsewhere" });
			independent.appendMessage({ role: "user", content: "still owned", timestamp: 1 });
			expect(existsSync(source)).toBe(true);
			expect(existsSync(archived ? join(sessionDir, "archived", basename(file)) : file)).toBe(false);
		} finally {
			independent.close();
		}
	},
);

test("a failed archive broadcasts notLoaded after disposing the runtime", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = saved(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	mkdirSync(join(sessionDir, "archived"));
	writeFileSync(join(sessionDir, "archived", basename(file)), "collision");
	await expect(a.client.request("thread/archive", { threadId: id })).rejects.toMatchObject({ code: "archiveConflict" });
	expect(threads.loadedCount()).toBe(0);
	expect(a.notifications).toContainEqual({
		method: "thread/status/changed",
		params: { threadId: id, status: "notLoaded" },
	});
	expect(a.notifications.some((n) => n.method === "thread/archived")).toBe(false);
});

test("idle ownership loss rejects admission and unloads even without a mapped turn", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = saved(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	writeFileSync(`${file}.lock-owner`, "replacement-owner");
	await expect(a.client.request("turn/start", { threadId: id, text: "go" })).rejects.toMatchObject({
		code: "threadLockedElsewhere",
	});
	await vi.waitFor(() => expect(threads.loadedCount()).toBe(0));
	expect(a.notifications.some((n) => n.method === "error")).toBe(true);
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
});

test("unload settles a cancelled start without waiting for a non-cooperative input hook", async () => {
	let enter!: () => void;
	let open!: () => void;
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const { cwd, threads, connect } = await startServer({
		extraExtensions: [
			{
				name: "hold",
				factory: (k) => {
					k.on("input", async () => {
						enter();
						await gate;
						return { action: "continue" as const };
					});
				},
			},
		],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	let answered = false;
	let disposed = false;
	const starting = a.client
		.request("turn/start", { threadId: thread.id, text: "go", requestId: "cancel-token" })
		.then((value) => {
			answered = true;
			return value;
		});
	await entered;
	const closing = threads.unload(thread.id).then(() => {
		disposed = true;
	});
	try {
		await vi.waitFor(
			() => {
				expect(answered).toBe(true);
				expect(disposed).toBe(true);
			},
			{ timeout: 1000 },
		);
		expect(await starting).toEqual({ status: "cancelled", threadId: thread.id, requestId: "cancel-token" });
	} finally {
		open();
		await starting;
		await closing;
	}
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
});
