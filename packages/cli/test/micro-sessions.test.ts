import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectSession } from "../src/experimental/micro/sessions.ts";

describe("micro session selection", () => {
	const directories: string[] = [];
	let sessionsDir: string;
	let cwd: string;

	beforeEach(async () => {
		sessionsDir = await mkdtemp(join(tmpdir(), "knightcode-micro-sessions-"));
		cwd = await mkdtemp(join(tmpdir(), "knightcode-micro-cwd-"));
		directories.push(sessionsDir, cwd);
	});

	afterEach(async () => {
		while (directories.length > 0) {
			await rm(directories.pop()!, { recursive: true, force: true }).catch(() => {});
		}
	});

	async function seedTranscript(path: string): Promise<void> {
		await writeFile(join(path, "main.jsonl"), '{"kind":"conversation"}\n');
	}

	/** Session directories only: the lock file sits beside them under the same root. */
	async function sessionDirectories(root: string): Promise<string[]> {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() && /^\d{13}-[0-9a-f-]{36}$/u.test(entry.name))
			.map((entry) => entry.name);
	}

	it("discards a created session that never opened storage", async () => {
		const location = await selectSession(cwd, false, sessionsDir);
		const root = join(location.path, "..");
		expect(await sessionDirectories(root)).toHaveLength(1);

		await location.discard();
		expect(await sessionDirectories(root)).toHaveLength(0);
	});

	it("keeps a session that wrote a transcript", async () => {
		const location = await selectSession(cwd, false, sessionsDir);
		await seedTranscript(location.path);
		await location.discard();
		expect(await sessionDirectories(join(location.path, ".."))).toHaveLength(1);
	});

	it("continues into the newest session that has a transcript", async () => {
		const first = await selectSession(cwd, false, sessionsDir);
		await seedTranscript(first.path);
		await first.release();

		// A later launch that failed before storage opened leaves an empty directory behind.
		const abandoned = await selectSession(cwd, false, sessionsDir);
		await abandoned.release();
		await mkdir(abandoned.path, { recursive: true });

		const continued = await selectSession(cwd, true, sessionsDir);
		expect(continued.path).toBe(first.path);
		await continued.release();
	});

	it("reports no session when every directory is empty", async () => {
		const abandoned = await selectSession(cwd, false, sessionsDir);
		await abandoned.release();
		await expect(selectSession(cwd, true, sessionsDir)).rejects.toThrow(/No micro session exists/);
	});
});
