import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@knightcode/app-server-protocol";
import { afterEach, expect, test, vi } from "vitest";
import { attachJsonlLineReader } from "../../src/modes/rpc/jsonl.ts";
import { AppServerClient } from "../../src/app-server/client.ts";
import { createStdioTransport, DEFAULT_STDIO_LIMITS } from "../../src/app-server/stdio.ts";
import { getDefaultSessionDir, SessionManager } from "../../src/core/session-manager.ts";

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode !== null || child.signalCode !== null) continue;
		const exited = exitCode(child);
		child.kill("SIGKILL");
		await exited;
	}
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function spawnServer(stall?: "command" | "factory") {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-cwd-"));
	dirs.push(agentDir, cwd);
	const shutdownMark = join(agentDir, "shutdown-mark");
	// Vitest runs under Node even when invoked with bun x. Source CLI runs under Bun.
	const child = spawn(
		"bun",
		[
			"src/cli.ts",
			"app-server",
			"-e",
			join(import.meta.dirname, "fixtures/faux-extension.ts"),
			...(stall ? ["-e", join(import.meta.dirname, "fixtures/noncooperative-extension.ts")] : []),
		],
		{
			cwd: join(import.meta.dirname, "../.."),
			env: {
				...process.env,
				KNIGHTCODE_CODING_AGENT_DIR: agentDir,
				KC_TEST_SHUTDOWN_FILE: shutdownMark,
				KC_TEST_HOLD_FACTORY: stall === "factory" ? "1" : "0",
			},
			stdio: ["pipe", "pipe", "inherit"],
		},
	);
	children.push(child);
	child.stdin!.on("error", () => {});
	const lines: Array<Record<string, unknown>> = [];
	const waiters = new Set<() => void>();
	attachJsonlLineReader(child.stdout!, (line) => {
		lines.push(JSON.parse(line));
		for (const wake of [...waiters]) wake();
	});
	const waitFor = (predicate: (m: Record<string, unknown>) => boolean) =>
		new Promise<Record<string, unknown>>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("timed out")), 30_000);
			const check = () => {
				const hit = lines.find(predicate);
				if (!hit) return;
				clearTimeout(timer);
				waiters.delete(check);
				resolve(hit);
			};
			waiters.add(check);
			check();
		});
	const send = (message: unknown) => child.stdin!.write(`${JSON.stringify(message)}\n`);
	return { child, cwd, agentDir, waitFor, send, shutdownMark };
}

async function handshakeAndThread(s: ReturnType<typeof spawnServer>): Promise<string> {
	s.send({
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "e2e", version: "0" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} },
	});
	await s.waitFor((m) => m.id === 1);
	s.send({ method: "initialized", params: {} });
	// The thread loads the -e extension, which registers the faux provider (§5.2).
	s.send({ id: 2, method: "thread/start", params: { cwd: s.cwd } });
	const thread = ((await s.waitFor((m) => m.id === 2)).result as { thread: { id: string } }).thread;
	s.send({ id: 3, method: "model/list", params: {} });
	const models = (await s.waitFor((m) => m.id === 3)).result as { models: Array<{ provider: string; id: string }> };
	const faux = models.models.find((m) => m.provider === "faux-e2e")!;
	s.send({
		id: 4,
		method: "thread/settings/update",
		params: { threadId: thread.id, model: { provider: faux.provider, id: faux.id } },
	});
	await s.waitFor((m) => m.id === 4);
	return thread.id;
}

const exitCode = (child: ChildProcess) => new Promise<number | null>((resolve) => child.on("exit", resolve));

test("EOF answers a start parked in a non-cooperative command before unloading", async () => {
	const s = spawnServer("command");
	const threadId = await handshakeAndThread(s);
	s.send({ id: 5, method: "turn/start", params: { threadId, text: "/hold", requestId: "eof-token" } });
	await vi.waitFor(() => expect(readFileSync(s.shutdownMark, "utf8")).toContain("preflight_entered"), {
		timeout: 30_000,
	});
	const exited = exitCode(s.child);
	s.child.stdin!.end();
	expect((await s.waitFor((m) => m.id === 5)).result).toEqual({
		status: "cancelled",
		threadId,
		requestId: "eof-token",
	});
	expect(await exited).toBe(0);
	expect(readFileSync(s.shutdownMark, "utf8")).toContain("session_shutdown");
}, 60_000);

test("EOF answers a non-cooperative loading request with shuttingDown before the hard exit", async () => {
	const s = spawnServer("factory");
	s.send({
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "e2e", version: "0" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} },
	});
	await s.waitFor((m) => m.id === 1);
	s.send({ method: "initialized", params: {} });
	s.send({ id: 2, method: "thread/start", params: { cwd: s.cwd } });
	await vi.waitFor(() => expect(readFileSync(s.shutdownMark, "utf8")).toContain("factory_entered"), {
		timeout: 30_000,
	});
	const exited = exitCode(s.child);
	s.child.stdin!.end();
	expect((await s.waitFor((m) => m.id === 2)).error).toMatchObject({ code: "shuttingDown" });
	expect(await exited).toBe(0);
}, 60_000);

test("a history turn above 64 MiB round-trips fully through bounded stdio payload chunks", async () => {
	const s = spawnServer();
	const manager = SessionManager.create(s.cwd, getDefaultSessionDir(s.cwd, s.agentDir));
	manager.appendMessage({ role: "user", content: "z".repeat(65 * 1024 * 1024), timestamp: 1 });
	const id = manager.getSessionId();
	const file = manager.getSessionFile()!;
	const header = manager.getHeader();
	manager.close();
	const client = new AppServerClient(
		createStdioTransport(
			s.child.stdout!,
			(text) =>
				new Promise<void>((resolve, reject) => {
					s.child.stdin!.write(text, (error) => (error ? reject(error) : resolve()));
				}),
			{ ...DEFAULT_STDIO_LIMITS, maxLineBytes: 1024 * 1024 },
		),
	);
	const exited = exitCode(s.child);
	try {
		await client.initialize();
		const history = await client.request("thread/read", { threadId: id });
		expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThan(1024 * 1024);
		expect("payload" in history.turns[0]).toBe(true);
		// The saved source can change after capture; the issued payload must remain immutable.
		writeFileSync(file, `${JSON.stringify(header)}\n`);
		const turn = await client.resolveTurn(history.turns[0]);
		const item = turn.items[0];
		expect(item.type).toBe("userMessage");
		if (item.type !== "userMessage") throw new Error("expected user text");
		expect(item.text.length).toBe(65 * 1024 * 1024);
		expect(item.text).toBe("z".repeat(65 * 1024 * 1024));
	} finally {
		client.close();
		s.child.stdin!.end();
	}
	expect(await exited).toBe(0);
}, 90_000);

test("a response sent just before stdin closes still reaches the client", async () => {
	const s = spawnServer();
	const exited = exitCode(s.child);
	s.send({
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "e2e", version: "0" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} },
	});
	s.child.stdin!.end();
	expect((await s.waitFor((m) => m.id === 1)).result).toMatchObject({ protocolVersion: PROTOCOL_VERSION });
	expect(await exited).toBe(0);
}, 60_000);

test("a client that stops reading stdout cannot keep the server alive past the deadline", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-agent-"));
	dirs.push(agentDir);
	// stdout is piped and never read, so the pipe fills and writes block.
	const child = spawn("bun", ["src/cli.ts", "app-server"], {
		cwd: join(import.meta.dirname, "../.."),
		env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir },
		stdio: ["pipe", "pipe", "inherit"],
	});
	children.push(child);
	child.stdin!.on("error", () => {});
	const exited = exitCode(child);
	// Each line is answered with a notInitialized error: megabytes of output nobody reads.
	const lines = Array.from({ length: 20_000 }, (_, i) =>
		JSON.stringify({ id: i, method: "model/list", params: {} }),
	).join("\n");
	child.stdin!.write(`${lines}\n`);
	const started = Date.now();
	child.stdin!.end();
	expect(await exited).toBe(0);
	expect(Date.now() - started).toBeLessThan(20_000);
}, 60_000);

test("knightcode app-server completes a handshake and a faux turn over stdio, and exits on EOF", async () => {
	const s = spawnServer();
	const threadId = await handshakeAndThread(s);
	s.send({ id: 5, method: "turn/start", params: { threadId, text: "hi" } });
	const done = await s.waitFor((m) => m.method === "turn/completed");
	expect((done.params as { turn: { status: string } }).turn.status).toBe("completed");
	const exited = exitCode(s.child);
	s.child.stdin!.end();
	expect(await exited).toBe(0);
}, 60_000);

test("a client whose end of stdout is gone still gets an orderly shutdown: extensions hear session_shutdown, exit 0", async () => {
	const s = spawnServer();
	await handshakeAndThread(s);
	const exited = exitCode(s.child);
	// The desktop app died: its read end of our stdout closes, so the next write fails with EPIPE.
	s.child.stdout!.destroy();
	s.send({ id: 9, method: "model/list", params: {} });
	expect(await exited).toBe(0);
	expect(readFileSync(s.shutdownMark, "utf8")).toContain("session_shutdown");
}, 60_000);

test("closing stdin mid-turn unloads everything and exits 0 within the deadline", async () => {
	const s = spawnServer();
	const threadId = await handshakeAndThread(s);
	s.send({ id: 5, method: "turn/start", params: { threadId, text: "hi" } });
	await s.waitFor((m) => m.id === 5);
	s.send({ id: 6, method: "turn/start", params: { threadId, text: "long" } });
	await s.waitFor((m) => m.method === "item/agentMessage/delta");
	const exited = exitCode(s.child);
	const started = Date.now();
	s.child.stdin!.end();
	expect(await exited).toBe(0);
	expect(Date.now() - started).toBeLessThan(15_000);
}, 60_000);
