import type { ResultOf, Turn } from "@knightcode/app-server-protocol";
import { fauxProvider } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { AppServerClient } from "../../src/app-server/client.ts";
import { type AppServerContext, createAppServerContext } from "../../src/app-server/context.ts";
import { appServerHandlers } from "../../src/app-server/entry.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { ThreadManager, type ThreadManagerOptions } from "../../src/app-server/threads.ts";

let counter = 0;
const cleanups: Array<() => Promise<void>> = [];

const tempDirs: string[] = [];

/** A temporary directory that cleanupServers removes once every server has closed. */
export function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/**
 * Kill a child and wait for it to exit, so its files are closed before its directories go: SIGTERM, then SIGKILL
 * after `ms`; a child still running after that fails the cleanup rather than leaking.
 */
export async function stopChild(child: ChildProcess, ms = 10_000): Promise<void> {
	const gone = () => child.exitCode !== null || child.signalCode !== null;
	// The listener first: a child exiting between a check and the listener would otherwise go unseen.
	const exited = new Promise<boolean>((resolve) => child.once("exit", () => resolve(true)));
	if (gone()) return;
	const within = async () => {
		if (gone()) return true;
		let timer: NodeJS.Timeout | undefined;
		const done = await Promise.race([
			exited,
			new Promise<boolean>((resolve) => (timer = setTimeout(resolve, ms, false))),
		]);
		clearTimeout(timer);
		return done;
	};
	child.kill();
	if (await within()) return;
	child.kill("SIGKILL");
	if (!(await within())) throw new Error(`child ${child.pid} did not exit`);
}

/** Call from afterEach. */
export async function cleanupServers(): Promise<void> {
	const errors: unknown[] = [];
	const removals = tempDirs
		.splice(0)
		.map((dir) => () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
	for (const cleanup of [...cleanups.splice(0), ...removals]) {
		try {
			await cleanup();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, "server cleanup failed");
}

export interface TestClient {
	client: AppServerClient;
	initializeResult: ResultOf<"initialize">;
	notifications: Array<{ method: string; params: Record<string, unknown> }>;
	waitFor(
		method: string,
		predicate?: (params: Record<string, unknown>) => boolean,
		ms?: number,
	): Promise<Record<string, unknown>>;
	readTurns(threadId: string, cursor?: string): Promise<Turn[]>;
	close(): void;
}

export interface StartServerOptions extends ThreadManagerOptions {
	tokensPerSecond?: number;
	/** null: no explicit session dir, so threads use the per-project default layout under the temp agentDir. */
	sessionDir?: string | null;
	agentDir?: string;
}

export async function startServer(options: StartServerOptions = {}) {
	// Only directories made here are removed: a caller-supplied agentDir or sessionDir belongs to the caller.
	const created: string[] = [];
	const temp = (prefix: string) => {
		const dir = mkdtempSync(join(tmpdir(), prefix));
		created.push(dir);
		return dir;
	};
	const cwd = temp("knightcode-as-cwd-");
	const agentDir = options.agentDir ?? temp("knightcode-as-agent-");
	// "" is what a server without one reports (below), so a restart passing it back keeps the default layout.
	const sessionDir =
		options.sessionDir === null || options.sessionDir === ""
			? undefined
			: (options.sessionDir ?? temp("knightcode-as-sessions-"));
	const faux = fauxProvider({
		provider: `faux-as-${counter++}`,
		tokensPerSecond: options.tokensPerSecond,
		models: [
			{ id: "faux-1", reasoning: true },
			{ id: "faux-plain", reasoning: false },
		],
	});
	const ctx: AppServerContext = await createAppServerContext({
		agentDir,
		sessionDir,
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		// The root .env is auto-loaded with real keys; an unpinned thread could bill them.
		defaultModel: faux.getModel(),
	});
	ctx.models.registerNativeProvider(faux.provider);
	// The availability pass marks the faux provider configured, as test/virtual-models.test.ts does.
	await ctx.models.refresh({ allowNetwork: false });
	const threads = new ThreadManager(ctx, options);
	cleanups.push(async () => {
		try {
			await threads.closeAll();
		} finally {
			ctx.dispose();
			for (const dir of created) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	});
	const connect = async (
		mode: "desktop" | "tui" = "tui",
		options?: { optOutNotifications?: string[] },
	): Promise<TestClient> => {
		const client = createInProcessClient({
			handlers: appServerHandlers(ctx, threads),
			version: "0",
			mode,
			onInitialized: (c) => ctx.connections.add(c),
			onClose: (c) => {
				ctx.connections.delete(c);
				threads.disconnect(c);
			},
		});
		const notifications: TestClient["notifications"] = [];
		const waiters = new Set<() => void>();
		// Per method, the index after the last notification a waitFor returned: a repeated wait needs a newer one.
		const cursors = new Map<string, number>();
		client.onNotification((method, params) => {
			notifications.push({ method, params: params as Record<string, unknown> });
			for (const wake of [...waiters]) wake();
		});
		const initializeResult = await client.initialize(options);
		return {
			client,
			initializeResult,
			notifications,
			close: () => client.close(),
			async readTurns(threadId, cursor) {
				const result = await client.request("thread/read", { threadId, cursor });
				return Promise.all(result.turns.map((turn) => client.resolveTurn(turn)));
			},
			waitFor(method, predicate = () => true, ms = 5_000) {
				return new Promise((resolve, reject) => {
					const find = () => {
						const index = notifications.findIndex(
							(n, i) => i >= (cursors.get(method) ?? 0) && n.method === method && predicate(n.params),
						);
						if (index === -1) return undefined;
						cursors.set(method, index + 1);
						return notifications[index];
					};
					const hit = find();
					if (hit) return resolve(hit.params);
					const timer = setTimeout(() => {
						waiters.delete(wake);
						reject(new Error(`timed out waiting for ${method}`));
					}, ms);
					const wake = () => {
						const found = find();
						if (!found) return;
						clearTimeout(timer);
						waiters.delete(wake);
						resolve(found.params);
					};
					waiters.add(wake);
				});
			},
		};
	};
	// "" in the default layout: the caller asked for no session dir and has none to read.
	return { ctx, threads, faux, cwd, sessionDir: sessionDir ?? "", agentDir, connect };
}

/** Resolves when `stream` prints a line equal to `text`. */
export function waitForLine(stream: Readable, text: string, ms = 15_000): Promise<void> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (!buffer.split("\n").includes(text)) return;
			clearTimeout(timer);
			stream.off("data", onData);
			resolve();
		};
		const timer = setTimeout(() => {
			stream.off("data", onData);
			reject(new Error(`timed out waiting for "${text}"`));
		}, ms);
		stream.on("data", onData);
	});
}
