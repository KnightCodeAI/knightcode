import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import * as fs from "fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as sdk from "../src/index.ts";
import { canonicalSessionPath, SessionHardLinkedError, SessionLockedError } from "../src/core/session-lock.ts";
import {
	CURRENT_SESSION_VERSION,
	loadEntriesFromFile,
	SessionClosedError,
	SessionLockLostError,
	SessionManager,
} from "../src/core/session-manager.ts";

// Spy the module consumed by SessionManager, preserving all real filesystem operations.
vi.mock("fs", { spy: true });
const realOpenSync = (await vi.importActual<typeof fs>("fs")).openSync;

/** Resolves when `stream` prints the line `text`. */
function lineFrom(stream: Readable, text: string): Promise<void> {
	return new Promise((resolve) => {
		let buffer = "";
		stream.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (buffer.split("\n").includes(text)) resolve();
		});
	});
}

const dirs: string[] = [];
const managers: SessionManager[] = [];
afterEach(() => {
	for (const manager of managers.splice(0)) manager.close();
	vi.mocked(fs.openSync).mockImplementation(realOpenSync);
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "knightcode-sm-lock-"));
	dirs.push(dir);
	return dir;
}

const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 1 });

function sessionWithConversation(): { dir: string; manager: SessionManager; file: string } {
	const dir = tempDir();
	const manager = SessionManager.create(dir, dir);
	managers.push(manager);
	manager.appendMessage(user("hi"));
	manager.appendMessage(user("again"));
	return { dir, manager, file: manager.getSessionFile()! };
}

const isLocked = (file: string) => lockfile.checkSync(file, { realpath: false });

/** Another process took the expired lock (written directly; see session-lock.test.ts). */
function takeOver(file: string): void {
	rmSync(`${file}.lock`, { recursive: true, force: true });
	mkdirSync(`${file}.lock`);
	writeFileSync(`${file}.lock-owner`, "another-process");
}

/** Every path that writes the file or moves the tree (the inventory above). */
const mutations: Array<[string, (m: SessionManager) => unknown]> = [
	["appendMessage", (m) => m.appendMessage(user("x"))],
	["appendCustomEntry", (m) => m.appendCustomEntry("x")],
	["appendThinkingLevelChange", (m) => m.appendThinkingLevelChange("low")],
	["appendModelChange", (m) => m.appendModelChange("faux", "model")],
	[
		"appendUsage",
		(m) =>
			m.appendUsage("test", "faux", "model", {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			}),
	],
	["appendCompaction", (m) => m.appendCompaction("summary", m.getLeafId(), 1)],
	["appendCustomMessageEntry", (m) => m.appendCustomMessageEntry("test", "text", true)],
	["appendContextEdit", (m) => m.appendContextEdit(m.getEntries()[0]?.id ?? "missing", null)],
	["_persist", (m) => m._persist(m.getEntries()[0])],
	["appendLabelChange", (m) => m.appendLabelChange(m.getLeafId()!, "label")],
	["appendSessionInfo", (m) => m.appendSessionInfo("name")],
	["branch", (m) => m.branch(m.getEntries()[0]?.id ?? "missing")],
	["resetLeaf", (m) => m.resetLeaf()],
	["branchWithSummary", (m) => m.branchWithSummary(m.getEntries()[0]?.id ?? "missing", "summary")],
	["createBranchedSession", (m) => m.createBranchedSession(m.getLeafId()!)],
	["newSession", (m) => m.newSession()],
	["setSessionFile", (m) => m.setSessionFile(m.getSessionFile()!)],
];

function snapshot(manager: SessionManager, file: string) {
	return {
		leaf: manager.getLeafId(),
		entries: manager.getEntries().map((e) => e.id),
		sessionFile: manager.getSessionFile(),
		disk: readFileSync(file, "utf8"),
	};
}

test("the public SDK exports ownership errors with their original identities", () => {
	expect(sdk).toMatchObject({ SessionLockedError, SessionHardLinkedError, SessionClosedError, SessionLockLostError });
});

describe("SessionManager lock", () => {
	test("a new session locks its selected destination before its first flush; close releases it", () => {
		const dir = tempDir();
		const manager = SessionManager.create(dir, dir);
		expect(existsSync(manager.getSessionFile()!)).toBe(false);
		expect(existsSync(`${manager.getSessionFile()}.lock`)).toBe(true);
		manager.appendMessage(user("hi"));
		expect(isLocked(manager.getSessionFile()!)).toBe(true);
		manager.close();
		expect(isLocked(manager.getSessionFile()!)).toBe(false);
	});

	test("opening a file another holder locks throws SessionLockedError", () => {
		const { manager, file } = sessionWithConversation();
		manager.close();
		mkdirSync(`${file}.lock`);
		expect(() => SessionManager.open(file)).toThrow(SessionLockedError);
		rmSync(`${file}.lock`, { recursive: true });
		SessionManager.open(file).close();
	});

	test("two managers in one process share the lock until both close", () => {
		const { manager, file } = sessionWithConversation();
		const second = SessionManager.open(file);
		manager.close();
		expect(isLocked(file)).toBe(true);
		second.close();
		expect(isLocked(file)).toBe(false);
	});

	describe.each([
		["closed", SessionClosedError, (m: SessionManager) => m.close()],
		["lost", SessionLockLostError, (m: SessionManager) => takeOver(m.getSessionFile()!)],
	] as const)("a %s manager", (_state, error, makeUnwritable) => {
		test.each(mutations)("%s throws and changes neither memory nor disk", (_name, mutate) => {
			const { manager, file } = sessionWithConversation();
			makeUnwritable(manager);
			const before = snapshot(manager, file);
			expect(() => mutate(manager)).toThrow(error);
			expect(snapshot(manager, file)).toEqual(before);
		});
	});

	test("a closed manager stays readable and never writes after another holder opens the file", () => {
		const { manager, file } = sessionWithConversation();
		manager.close();
		manager.close();
		expect(manager.getEntries()).toHaveLength(2);
		const other = SessionManager.open(file);
		other.appendMessage(user("from the new holder"));
		const before = readFileSync(file, "utf8");
		expect(() => manager.appendMessage(user("stale writer"))).toThrow(SessionClosedError);
		expect(readFileSync(file, "utf8")).toBe(before);
		other.close();
	});

	test("a lost manager's close leaves the new holder's lock in place", () => {
		const { manager, file } = sessionWithConversation();
		takeOver(file);
		manager.close();
		expect(existsSync(`${file}.lock`)).toBe(true);
		expect(readFileSync(`${file}.lock-owner`, "utf8")).toBe("another-process");
	});

	test("branching moves the lock to the new file", () => {
		const { manager, file } = sessionWithConversation();
		manager.appendCustomEntry("marker");
		const branched = manager.createBranchedSession(manager.getLeafId()!)!;
		expect(isLocked(file)).toBe(false);
		expect(isLocked(branched)).toBe(true);
		manager.close();
	});

	test("forkFrom locks its destination before the file exists", () => {
		const { manager, file, dir } = sessionWithConversation();
		manager.close();
		// A fixed clock makes the destination name predictable: <timestamp>_<id>.jsonl.
		vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const destination = join(dir, `${stamp}_fork-dest.jsonl`);
		// Another holder already has the destination's lock: a fork that wrote before locking would leave
		// the file behind; one that locks first fails before writing anything.
		mkdirSync(`${destination}.lock`);
		expect(() => SessionManager.forkFrom(file, dir, dir, { id: "fork-dest" })).toThrow(SessionLockedError);
		expect(existsSync(destination)).toBe(false);
		rmSync(`${destination}.lock`, { recursive: true });
		const fork = SessionManager.forkFrom(file, dir, dir, { id: "fork-dest" });
		// The manager binds the canonical path: macOS temp dirs live under the /var -> /private/var symlink,
		// and Windows temp paths can be 8.3 short names.
		expect(fork.getSessionFile()).toBe(canonicalSessionPath(destination));
		expect(isLocked(destination)).toBe(true);
		fork.close();
	});

	test("forkFrom at a leaf writes only that path, as one file", () => {
		const { manager, file, dir } = sessionWithConversation();
		const [first] = manager.getEntries();
		manager.branch(first.id);
		manager.appendMessage(user("other branch"));
		const leaf = manager.getLeafId()!;
		manager.close();
		const before = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
		const fork = SessionManager.forkFrom(file, dir, dir, { leafId: leaf });
		expect(fork.getEntries().map((e) => e.id)).toEqual([first.id, leaf]);
		expect(readdirSync(dir).filter((name) => name.endsWith(".jsonl"))).toHaveLength(before.length + 1);
		fork.close();
		expect(() => SessionManager.forkFrom(file, dir, dir, { leafId: "missing" })).toThrow();
		expect(readdirSync(dir).filter((name) => name.endsWith(".jsonl"))).toHaveLength(before.length + 1);
	});

	test("reading never writes; the owner repairs a missing final newline", () => {
		const { manager, file } = sessionWithConversation();
		manager.close();
		// A crash mid-append leaves the last line without its newline.
		const content = readFileSync(file, "utf8").replace(/\n$/, "");
		writeFileSync(file, content);
		loadEntriesFromFile(file);
		const fork = SessionManager.forkFrom(file, join(file, ".."), join(file, ".."));
		fork.close();
		expect(readFileSync(file, "utf8")).toBe(content);
		SessionManager.open(file).close();
		expect(readFileSync(file, "utf8")).toBe(`${content}\n`);
	});

	test("a file that fails to load after the lock is taken leaves no lock", () => {
		const dir = tempDir();
		const file = join(dir, "2026-10-11T00-00-00-000Z_bad.jsonl");
		// "../escape" passes discovery (readSessionHeader only checks that `id` is a string) and fails
		// assertValidSessionId in _loadEntries, after the lock is taken.
		appendFileSync(
			file,
			`${JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id: "../escape", timestamp: "2026-10-11T00:00:00.000Z", cwd: dir })}\n`,
		);
		expect(() => SessionManager.open(file)).toThrow();
		expect(isLocked(file)).toBe(false);
	});

	test("a manager whose file another process took rejects writes before any refresh, and close leaves their lock", async () => {
		const { manager, file } = sessionWithConversation();
		// The lock expired while this process stalled; another process takes it.
		rmSync(`${file}.lock`, { recursive: true, force: true });
		const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures/take-session-lock.ts"), file], {
			stdio: ["pipe", "pipe", "inherit"],
		});
		try {
			await lineFrom(child.stdout!, "taken");
			const before = readFileSync(file, "utf8");
			expect(() => manager.appendMessage(user("stale writer"))).toThrow(SessionLockLostError);
			expect(readFileSync(file, "utf8")).toBe(before);
			manager.close();
			expect(isLocked(file)).toBe(true);
		} finally {
			child.stdin!.end();
			await once(child, "exit");
		}
	});

	test("a refused branch destination preserves the original writable manager", () => {
		const { manager, file, dir } = sessionWithConversation();
		vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
		const destination = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_branch-dest.jsonl`);
		mkdirSync(`${destination}.lock`);
		const before = snapshot(manager, file);
		expect(() => manager.createBranchedSession(manager.getLeafId()!, { id: "branch-dest" })).toThrow(
			SessionLockedError,
		);
		expect(snapshot(manager, file)).toEqual(before);
		expect(existsSync(destination)).toBe(false);
		manager.appendMessage(user("still writable"));
		expect(readFileSync(file, "utf8")).toContain("still writable");
	});

	test("branch publication refuses an unlocked collision without removing it", () => {
		const { manager, file, dir } = sessionWithConversation();
		vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
		const destination = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_collision.jsonl`);
		writeFileSync(destination, "unrelated import");
		const before = snapshot(manager, file);
		expect(() => manager.createBranchedSession(manager.getLeafId()!, { id: "collision" })).toThrow("already exists");
		expect(snapshot(manager, file)).toEqual(before);
		expect(readFileSync(destination, "utf8")).toBe("unrelated import");
		expect(isLocked(destination)).toBe(false);
	});

	test("an invalid switch closes the partially rebound manager and releases both locks", () => {
		const { manager, file, dir } = sessionWithConversation();
		const target = join(dir, "invalid.jsonl");
		writeFileSync(target, "not a session");
		const source = readFileSync(file, "utf8");
		expect(() => manager.setSessionFile(target)).toThrow("not a valid");
		for (const [, mutate] of mutations) expect(() => mutate(manager)).toThrow(SessionClosedError);
		expect(readFileSync(file, "utf8")).toBe(source);
		expect(readFileSync(target, "utf8")).toBe("not a session");
		expect(isLocked(file)).toBe(false);
		expect(isLocked(target)).toBe(false);
	});

	test.each(["empty", "migration"])("a %s initialization write failure closes the manager", (kind) => {
		const { manager, file, dir } = sessionWithConversation();
		const target = join(dir, "target.jsonl");
		const content =
			kind === "empty"
				? ""
				: `${JSON.stringify({ type: "session", version: 2, id: "old", cwd: dir, timestamp: new Date().toISOString() })}\n`;
		writeFileSync(target, content);
		const source = readFileSync(file, "utf8");
		const original = realOpenSync;
		const canonicalTarget = canonicalSessionPath(target);
		vi.mocked(fs.openSync).mockImplementation((path, flags, mode) => {
			if (String(path) === canonicalTarget && flags === "w") throw new Error("injected I/O failure");
			return original(path, flags, mode);
		});
		expect(() => manager.setSessionFile(target)).toThrow("injected I/O failure");
		for (const [, mutate] of mutations) expect(() => mutate(manager)).toThrow(SessionClosedError);
		expect(readFileSync(file, "utf8")).toBe(source);
		expect(readFileSync(target, "utf8")).toBe(content);
		expect(isLocked(file)).toBe(false);
		expect(isLocked(target)).toBe(false);
	});

	test("refusing a target lock leaves the original manager writable", () => {
		const { manager, file, dir } = sessionWithConversation();
		const target = join(dir, "busy.jsonl");
		mkdirSync(`${target}.lock`);
		const before = snapshot(manager, file);
		expect(() => manager.setSessionFile(target)).toThrow(SessionLockedError);
		expect(snapshot(manager, file)).toEqual(before);
		manager.appendMessage(user("original"));
		expect(readFileSync(file, "utf8")).toContain("original");
	});

	test("an in-memory manager takes no lock and close changes nothing", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage(user("hi"));
		manager.close();
		expect(() => manager.appendMessage(user("still fine"))).not.toThrow();
	});
});
