import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const ENTRY = resolve(import.meta.dirname, "../../src/engine-entry.ts");
const TOKEN = "0123456789abcdef".repeat(3);

interface Run {
	child: ChildProcess;
	stdout: string[];
	stderr: string[];
}

describe("engine entry", () => {
	const runs: Run[] = [];
	const dirs: string[] = [];

	afterEach(() => {
		for (const run of runs.splice(0)) run.child.kill();
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	// A throwaway agent directory, so no credential of the developer's is read,
	// and no session is ever created: nothing here can bill anything.
	function start(env: Record<string, string>): Run {
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-engine-entry-"));
		dirs.push(agentDir);
		const child = spawn("bun", ["run", ENTRY], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				KNIGHTCODE_CODING_AGENT_DIR: agentDir,
				KNIGHTCODE_OFFLINE: "1",
				KNIGHTCODE_ENGINE_TOKEN: TOKEN,
				...env,
			},
		});
		const run: Run = { child, stdout: [], stderr: [] };
		child.stdout!.on("data", (chunk: Buffer) => run.stdout.push(chunk.toString("utf-8")));
		child.stderr!.on("data", (chunk: Buffer) => run.stderr.push(chunk.toString("utf-8")));
		runs.push(run);
		return run;
	}

	async function portOf(run: Run): Promise<number> {
		await waitFor(() => run.stdout.join("").includes("\n"), 30_000);
		const line = JSON.parse(run.stdout.join("").split("\n")[0]) as { type: string; port: number };
		expect(line.type).toBe("listening");
		return line.port;
	}

	function exitOf(run: Run, ms: number): Promise<number | null> {
		return Promise.race([
			new Promise<number | null>((resolveExit) => run.child.once("exit", (code) => resolveExit(code))),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the engine did not exit")), ms)),
		]);
	}

	test("prints the port line, exits when stdin closes, and binds a pinned port on the next run", async () => {
		const first = start({});
		const port = await portOf(first);
		expect(port).toBeGreaterThan(0);
		expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
		first.child.stdin!.end();
		expect(await exitOf(first, 15_000)).toBe(0);

		const second = start({ KNIGHTCODE_ENGINE_PORT: String(port) });
		expect(await portOf(second)).toBe(port);
		second.child.stdin!.end();
		expect(await exitOf(second, 15_000)).toBe(0);
	}, 90_000);

	test("a pinned port that is taken is an exit before ready with the reason on stderr", async () => {
		const blocker = createServer();
		await new Promise<void>((resolveListen) => blocker.listen(0, "127.0.0.1", resolveListen));
		const port = (blocker.address() as AddressInfo).port;
		try {
			const run = start({ KNIGHTCODE_ENGINE_PORT: String(port) });
			expect(await exitOf(run, 30_000)).not.toBe(0);
			expect(run.stderr.join("")).toContain("EADDRINUSE");
			expect(run.stdout.join("")).toBe("");
		} finally {
			blocker.close();
		}
	}, 45_000);

	test("a pinned port that is not a port is exit 2", async () => {
		const run = start({ KNIGHTCODE_ENGINE_PORT: "eighty" });
		expect(await exitOf(run, 30_000)).toBe(2);
		expect(run.stderr.join("")).toContain("KNIGHTCODE_ENGINE_PORT");
	}, 45_000);
});

async function waitFor(predicate: () => boolean, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolveTick) => setTimeout(resolveTick, 25));
	}
}
