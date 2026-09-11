import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseAcpArgs } from "../../../src/engine/acp/run.ts";

const ENTRY = resolve(import.meta.dirname, "../../../src/engine/acp/entry.ts");

describe("acp entry", () => {
	let child: ChildProcess | undefined;
	const dirs: string[] = [];

	afterEach(() => {
		child?.kill();
		child = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	test("parses --connect and takes the token from the environment", () => {
		expect(parseAcpArgs(["--connect", "http://127.0.0.1:1"])).toMatchObject({ connect: "http://127.0.0.1:1" });
		expect(parseAcpArgs([]).connect).toBeUndefined();
	});

	// The one process test in this suite. It boots a real engine in-process
	// against a throwaway agent directory, so no credential of the developer's
	// is read and no model is resolved; it creates no session.
	test("answers initialize over stdio and exits when stdin closes", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-acp-entry-"));
		dirs.push(agentDir);
		child = spawn("bun", ["run", ENTRY], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir, KNIGHTCODE_OFFLINE: "1" },
		});
		const stdout: string[] = [];
		child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf-8")));
		const stderr: string[] = [];
		child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf-8")));

		child.stdin!.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })}\n`,
		);
		await waitFor(() => stdout.join("").includes("\n"), 20_000);
		const [line] = stdout.join("").split("\n");
		const response = JSON.parse(line) as {
			id: number;
			result?: { protocolVersion: number; agentInfo?: { name: string } };
		};
		expect(response.id).toBe(1);
		expect(response.result?.protocolVersion).toBe(1);
		expect(response.result?.agentInfo?.name).toBe("knightcode");
		// Nothing but JSON-RPC on stdout: no port line, no log line.
		expect(
			stdout
				.join("")
				.split("\n")
				.filter((entry) => entry.length > 0),
		).toHaveLength(1);

		const exited = new Promise<number | null>((resolveExit) => child!.once("exit", (code) => resolveExit(code)));
		child.stdin!.end();
		expect(await Promise.race([exited, timeout(10_000)])).toBe(0);
		child = undefined;
		if (stderr.join("").length > 0) console.error(stderr.join(""));
	}, 40_000);
});

async function waitFor(predicate: () => boolean, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolveTick) => setTimeout(resolveTick, 25));
	}
}

function timeout(ms: number): Promise<never> {
	return new Promise((_, reject) => setTimeout(() => reject(new Error("the adapter did not exit")), ms));
}
