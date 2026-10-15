import type { ResultOf, Turn } from "@knightcode/app-server-protocol";
import { fauxProvider } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
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

/** Call from afterEach. */
export async function cleanupServers(): Promise<void> {
	const errors: unknown[] = [];
	for (const cleanup of cleanups.splice(0)) {
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
	sessionDir?: string;
	agentDir?: string;
}

export async function startServer(options: StartServerOptions = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "knightcode-as-cwd-"));
	const agentDir = options.agentDir ?? mkdtempSync(join(tmpdir(), "knightcode-as-agent-"));
	const sessionDir = options.sessionDir ?? mkdtempSync(join(tmpdir(), "knightcode-as-sessions-"));
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
			for (const dir of [cwd, agentDir, sessionDir])
				await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
					const find = () => notifications.find((n) => n.method === method && predicate(n.params));
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
	return { ctx, threads, faux, cwd, sessionDir, agentDir, connect };
}

/** Resolves when `stream` prints a line equal to `text`. */
export function waitForLine(stream: Readable, text: string, ms = 15_000): Promise<void> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(() => reject(new Error(`timed out waiting for "${text}"`)), ms);
		stream.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (buffer.split("\n").includes(text)) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
}
