import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { FileHistory } from "../src/extensions/undo/history.ts";

let dir: string;
let work: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kc-undo-"));
	work = join(dir, "work");
	mkdirSync(work);
	process.env[ENV_AGENT_DIR] = dir;
});
afterEach(() => {
	delete process.env[ENV_AGENT_DIR];
	rmSync(dir, { recursive: true, force: true });
});

describe("FileHistory", () => {
	test("record backs up the pre-edit content and restore puts it back", () => {
		const file = join(work, "a.txt");
		writeFileSync(file, "original");
		const history = FileHistory.forSession("s1");
		history.record("u1", file);
		writeFileSync(file, "edited");

		const abandoned = history.abandoned(["u1"]);
		expect([...abandoned.files.keys()]).toHaveLength(1);
		expect(history.restore(abandoned.files)).toEqual({ restored: 1, failed: [] });
		expect(readFileSync(file, "utf8")).toBe("original");
	});

	test("a file that did not exist yet is deleted on restore", () => {
		const file = join(work, "new.txt");
		const history = FileHistory.forSession("s1");
		history.record("u1", file);
		writeFileSync(file, "created");

		history.restore(history.abandoned(["u1"]).files);
		expect(existsSync(file)).toBe(false);
	});

	test("only the first record per checkpoint and file is kept", () => {
		const file = join(work, "a.txt");
		writeFileSync(file, "v1");
		const history = FileHistory.forSession("s1");
		history.record("u1", file);
		writeFileSync(file, "v2");
		history.record("u1", file);
		writeFileSync(file, "v3");

		history.restore(history.abandoned(["u1"]).files);
		expect(readFileSync(file, "utf8")).toBe("v1");
	});

	test("the earliest abandoned checkpoint wins per file", () => {
		const file = join(work, "a.txt");
		writeFileSync(file, "v1");
		const history = FileHistory.forSession("s1");
		history.record("u1", file);
		writeFileSync(file, "v2");
		history.record("u2", file);
		writeFileSync(file, "v3");

		history.restore(history.abandoned(["u1", "u2"]).files);
		expect(readFileSync(file, "utf8")).toBe("v1");
	});

	test("checkpoints outside the abandoned set are ignored", () => {
		const a = join(work, "a.txt");
		const b = join(work, "b.txt");
		writeFileSync(a, "a1");
		writeFileSync(b, "b1");
		const history = FileHistory.forSession("s1");
		history.record("u1", a);
		history.record("u2", b);
		writeFileSync(a, "a2");
		writeFileSync(b, "b2");

		history.restore(history.abandoned(["u2"]).files);
		expect(readFileSync(a, "utf8")).toBe("a2");
		expect(readFileSync(b, "utf8")).toBe("b1");
	});

	test("markShell is reported for the abandoned range", () => {
		const history = FileHistory.forSession("s1");
		history.markShell("u1");
		expect(history.abandoned(["u1"]).shellRan).toBe(true);
		expect(history.abandoned(["u2"]).shellRan).toBe(false);
	});

	test("state survives a new instance for the same session", () => {
		const file = join(work, "a.txt");
		writeFileSync(file, "original");
		FileHistory.forSession("s1").record("u1", file);
		writeFileSync(file, "edited");

		const reloaded = FileHistory.forSession("s1");
		reloaded.restore(reloaded.abandoned(["u1"]).files);
		expect(readFileSync(file, "utf8")).toBe("original");
	});

	test("copyTo carries backups over to another session id", () => {
		const file = join(work, "a.txt");
		writeFileSync(file, "original");
		const history = FileHistory.forSession("s1");
		history.record("u1", file);
		writeFileSync(file, "edited");
		history.copyTo("s2");

		const forked = FileHistory.forSession("s2");
		forked.restore(forked.abandoned(["u1"]).files);
		expect(readFileSync(file, "utf8")).toBe("original");
	});

	test("copyTo without any backups is a no-op", () => {
		FileHistory.forSession("s1").copyTo("s2");
		expect(existsSync(join(dir, "file-history", "s2"))).toBe(false);
	});

	test("an unreadable source marks the checkpoint failed and records nothing", () => {
		const history = FileHistory.forSession("s1");
		history.record("u1", work); // a directory cannot be copied
		const abandoned = history.abandoned(["u1"]);
		expect(abandoned.failed).toBe(true);
		expect(abandoned.files.size).toBe(0);
	});

	test("prune removes session dirs older than the given age", () => {
		const file = join(work, "a.txt");
		writeFileSync(file, "x");
		FileHistory.forSession("old").record("u1", file);
		FileHistory.forSession("fresh").record("u1", file);
		const old = join(dir, "file-history", "old");
		const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
		utimesSync(old, past, past);

		FileHistory.prune(30);
		expect(existsSync(old)).toBe(false);
		expect(existsSync(join(dir, "file-history", "fresh"))).toBe(true);
	});
});
