import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import lockfile from "proper-lockfile";
import { afterEach, expect, test } from "vitest";
import { acquireSessionLock, type SessionLock, SessionLockedError } from "../src/core/session-lock.ts";

const FAST = { staleMs: 2_000, updateMs: 1_000 };
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Collects `stream`'s lines; `next(text)` resolves when a line equal to `text` has arrived. */
function lines(stream: Readable) {
	const seen: string[] = [];
	const waiters = new Set<() => void>();
	let buffer = "";
	stream.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		const parts = buffer.split("\n");
		buffer = parts.pop() ?? "";
		seen.push(...parts);
		for (const wake of [...waiters]) wake();
	});
	return {
		seen,
		next: (text: string) =>
			new Promise<void>((resolve) => {
				const check = () => {
					if (!seen.includes(text)) return;
					waiters.delete(check);
					resolve();
				};
				waiters.add(check);
				check();
			}),
	};
}

/** Retries until the stalled holder's lock has gone stale and this process takes it. */
async function takeWhenStale(file: string): Promise<SessionLock> {
	const deadline = Date.now() + 10_000;
	for (;;) {
		try {
			return acquireSessionLock(file, FAST);
		} catch (error) {
			if (!(error instanceof SessionLockedError) || Date.now() > deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

test.each([true, false])("another process cannot lock a directory alias (existing=%s)", async (existing) => {
	const dir = mkdtempSync(join(tmpdir(), "knightcode-lock-alias-"));
	dirs.push(dir);
	const alias = join(dir, "alias");
	symlinkSync(dir, alias, process.platform === "win32" ? "junction" : "dir");
	const file = join(dir, "s.jsonl");
	if (existing) writeFileSync(file, "");
	const child = spawn(
		process.execPath,
		[join(import.meta.dirname, "fixtures/take-session-lock.ts"), join(alias, "s.jsonl")],
		{
			stdio: ["pipe", "pipe", "inherit"],
		},
	);
	const exited = once(child, "exit");
	try {
		await lines(child.stdout!).next("taken");
		expect(() => acquireSessionLock(file)).toThrow(SessionLockedError);
		expect(existsSync(`${file}.lock`)).toBe(true);
	} finally {
		child.stdin!.end();
		await exited;
	}
	const lock = acquireSessionLock(file);
	lock.release();
});

for (const mode of ["release", "exit"] as const) {
	test(`a stalled holder that exits (${mode}) leaves the new holder's lock in place`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "knightcode-lock-proc-"));
		dirs.push(dir);
		const file = join(dir, "s.jsonl");
		const gate = join(dir, "gate");
		writeFileSync(file, "");
		const child = spawn(
			process.execPath,
			[join(import.meta.dirname, "fixtures/stall-session-lock.ts"), file, gate, mode],
			{
				stdio: ["ignore", "pipe", "inherit"],
			},
		);
		const exited = once(child, "exit");
		const out = lines(child.stdout!);
		await out.next("taken");
		const ours = await takeWhenStale(file);
		try {
			writeFileSync(gate, "");
			await out.next("lost=true");
			await exited;
			expect(lockfile.checkSync(file, { realpath: false })).toBe(true);
			expect(ours.lost).toBe(false);
		} finally {
			ours.release();
		}
	}, 30_000);
}
