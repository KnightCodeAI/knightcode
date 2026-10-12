import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
	acquireSessionLock,
	canonicalSessionPath,
	SessionHardLinkedError,
	SessionLockedError,
} from "../src/core/session-lock.ts";

// proper-lockfile's minimums: stale 2000 ms, update 1000 ms.
const FAST = { staleMs: 2_000, updateMs: 1_000 };
const dirs: string[] = [];
beforeEach(() => {
	// Before any acquisition, so proper-lockfile's refresh timers are fake too.
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
	vi.useRealTimers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sessionFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "knightcode-lock-"));
	dirs.push(dir);
	const file = join(dir, "s.jsonl");
	writeFileSync(file, "");
	return file;
}

const isLocked = (file: string) => lockfile.checkSync(file, { realpath: false });

/** Another process took the expired lock: a fresh lock directory and its own owner token. */
function takeOver(file: string): void {
	rmSync(`${file}.lock`, { recursive: true, force: true });
	mkdirSync(`${file}.lock`);
	writeFileSync(`${file}.lock-owner`, "another-process");
}

test("a second holder is refused, and one process shares a counted lock", () => {
	const file = sessionFile();
	const first = acquireSessionLock(file, FAST);
	const second = acquireSessionLock(file, FAST);
	first.release();
	expect(isLocked(file)).toBe(true);
	second.release();
	expect(isLocked(file)).toBe(false);
	mkdirSync(`${file}.lock`);
	expect(() => acquireSessionLock(file, FAST)).toThrow(SessionLockedError);
});

test("a takeover is caught at the next check, before any refresh runs, and release leaves the new holder alone", () => {
	const file = sessionFile();
	const ours = acquireSessionLock(file, FAST);
	expect(ours.lost).toBe(false);
	// Synchronous on purpose: no refresh timer has run.
	takeOver(file);
	expect(ours.lost).toBe(true);
	ours.release();
	expect(existsSync(`${file}.lock`)).toBe(true);
	expect(readFileSync(`${file}.lock-owner`, "utf8")).toBe("another-process");
});

test("a refresh after a takeover leaves the new holder's lock directory untouched", () => {
	const file = sessionFile();
	const ours = acquireSessionLock(file, FAST);
	takeOver(file);
	const before = statSync(`${file}.lock`).mtimeMs;
	// The refresh finds the directory is not ours (by mtime or by token) and reports a compromise; the
	// re-take finds a fresh lock and fails.
	vi.advanceTimersByTime(FAST.updateMs);
	expect(statSync(`${file}.lock`).mtimeMs).toBe(before);
	expect(ours.lost).toBe(true);
	ours.release();
	expect(existsSync(`${file}.lock`)).toBe(true);
});

test("a refresh that runs late keeps the lock when nobody took it", () => {
	const file = sessionFile();
	const lock = acquireSessionLock(file, FAST);
	// A sleeping laptop: the clock jumps past the stale threshold before the refresh runs. proper-lockfile
	// renews a late lock whose mtime is still its own, so no recovery is needed; this pins that.
	vi.setSystemTime(Date.now() + FAST.staleMs + 500);
	vi.advanceTimersByTime(FAST.updateMs);
	expect(lock.lost).toBe(false);
	expect(isLocked(file)).toBe(true);
	lock.release();
	expect(isLocked(file)).toBe(false);
});

test("a lock directory deleted under us is taken again", () => {
	const file = sessionFile();
	const lock = acquireSessionLock(file, FAST);
	rmSync(`${file}.lock`, { recursive: true, force: true });
	// The refresh fails with ENOENT, proper-lockfile reports a compromise, and nobody else holds it.
	vi.advanceTimersByTime(FAST.updateMs);
	expect(lock.lost).toBe(false);
	expect(isLocked(file)).toBe(true);
	lock.release();
});

test("an acquisition whose owner token cannot be written leaves no lock and no refresh timer", () => {
	const file = sessionFile();
	// A directory where the token file goes makes writeFileSync fail (EISDIR, or EPERM on Windows) after
	// lockSync has already succeeded.
	mkdirSync(`${file}.lock-owner`);
	expect(() => acquireSessionLock(file, FAST)).toThrow();
	expect(existsSync(`${file}.lock`)).toBe(false);
	expect(vi.getTimerCount()).toBe(0);
	rmSync(`${file}.lock-owner`, { recursive: true });
	const lock = acquireSessionLock(file, FAST);
	expect(lock.lost).toBe(false);
	lock.release();
});

test.each([true, false])("directory aliases share ownership for an existing=%s destination", (existing) => {
	const file = sessionFile();
	const dir = join(file, "..");
	const alias = join(dir, "alias");
	symlinkSync(dir, alias, process.platform === "win32" ? "junction" : "dir");
	const selected = existing ? file : join(dir, "new.jsonl");
	const aliased = join(alias, existing ? "s.jsonl" : "new.jsonl");
	const first = acquireSessionLock(selected, FAST);
	const second = acquireSessionLock(aliased, FAST);
	try {
		expect(canonicalSessionPath(aliased)).toBe(canonicalSessionPath(selected));
		first.release();
		expect(isLocked(selected)).toBe(true);
		second.release();
		expect(isLocked(selected)).toBe(false);
	} finally {
		first.release();
		second.release();
	}
});

test("a file symlink never creates an alias-specific sidecar", (context) => {
	const file = sessionFile();
	const alias = join(file, "..", "file-alias.jsonl");
	try {
		symlinkSync(file, alias, "file");
	} catch (error) {
		if (process.platform === "win32" && ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) {
			context.skip();
			return;
		}
		throw error;
	}
	const first = acquireSessionLock(file, FAST);
	const second = acquireSessionLock(alias, FAST);
	try {
		expect(existsSync(`${alias}.lock`)).toBe(false);
		expect(existsSync(`${alias}.lock-owner`)).toBe(false);
		first.release();
		expect(isLocked(file)).toBe(true);
	} finally {
		first.release();
		second.release();
	}
	rmSync(file);
	expect(() => acquireSessionLock(alias, FAST)).toThrow();
});

test("hard-linked transcripts are refused instead of claiming path ownership", () => {
	const file = sessionFile();
	const alias = join(file, "..", "hardlink.jsonl");
	linkSync(file, alias);
	expect(() => acquireSessionLock(file, FAST)).toThrow(SessionHardLinkedError);
	expect(() => acquireSessionLock(alias, FAST)).toThrow(SessionHardLinkedError);
	expect(existsSync(`${file}.lock`)).toBe(false);
});

test.skipIf(process.platform !== "win32")("case aliases share the counted Windows lock", () => {
	const file = sessionFile();
	const first = acquireSessionLock(file, FAST);
	const second = acquireSessionLock(file.toUpperCase(), FAST);
	first.release();
	expect(isLocked(file)).toBe(true);
	second.release();
	expect(isLocked(file)).toBe(false);
});

test("a deleted session directory loses the lock without crashing or recreating the directory", () => {
	const file = sessionFile();
	const lock = acquireSessionLock(file, FAST);
	rmSync(join(file, ".."), { recursive: true, force: true });
	vi.advanceTimersByTime(FAST.updateMs);
	expect(lock.lost).toBe(true);
	expect(existsSync(join(file, ".."))).toBe(false);
	expect(() => lock.release()).not.toThrow();
});

test("a refresh after another holder took and released the lock loses it instead of taking it again", () => {
	const file = sessionFile();
	const lock = acquireSessionLock(file, FAST);
	// The other holder appended while we stalled; our in-memory transcript lacks its entries.
	takeOver(file);
	rmSync(`${file}.lock`, { recursive: true, force: true });
	rmSync(`${file}.lock-owner`, { force: true });
	vi.advanceTimersByTime(FAST.updateMs);
	expect(lock.lost).toBe(true);
	expect(isLocked(file)).toBe(false);
	lock.release();
});

test("a new acquisition does not count on an entry another process took over", () => {
	const file = sessionFile();
	const first = acquireSessionLock(file, FAST);
	takeOver(file);
	expect(() => acquireSessionLock(file, FAST)).toThrow(SessionLockedError);
	expect(first.lost).toBe(true);
	first.release();
});
