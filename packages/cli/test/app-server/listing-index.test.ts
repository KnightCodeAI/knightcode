import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	readdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as SessionModule from "../../src/core/session-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";
import { listWithIndex, MAX_INDEX_BYTES } from "../../src/app-server/listing-index.ts";

const temporaryDirs: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupServers();
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function freshDir() {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	temporaryDirs.push(dir);
	return dir;
}

const userEntry = (text: string, parentId: string | null = null) => ({
	type: "message",
	id: randomUUID().slice(0, 8),
	parentId,
	timestamp: new Date().toISOString(),
	message: { role: "user", content: text, timestamp: Date.now() },
});

/** One real session file (header line, then one user entry; CURRENT_SESSION_VERSION is 3). */
function writeSession(
	dir: string,
	options: { text?: string; parentSession?: string; name?: string; timestamp?: string } = {},
) {
	const id = randomUUID();
	const file = join(dir, options.name ?? `2026-10-14T00-00-00-000Z_${id}.jsonl`);
	const header = {
		type: "session",
		version: 3,
		id,
		timestamp: options.timestamp ?? new Date().toISOString(),
		cwd: dir,
		...(options.parentSession ? { parentSession: options.parentSession } : {}),
	};
	writeFileSync(file, `${JSON.stringify(header)}\n${JSON.stringify(userEntry(options.text ?? "hello"))}\n`);
	return { id, file };
}
const writeSessions = (dir: string, count: number) =>
	Array.from({ length: count }, (_, i) => writeSession(dir, { text: `hello ${i}` }).file);
const indexPath = (dir: string) => join(dir, ".thread-index.json");
const indexOf = (dir: string) => JSON.parse(readFileSync(indexPath(dir), "utf8"));
const listCounting = async (dir: string) => {
	const opened: string[] = [];
	const listed = await listWithIndex(dir, { onRead: (path) => opened.push(path) });
	return { listed, opened };
};

test("a second listing opens nothing, forks and non-sessions included; an appended session is rescanned alone (§5.10)", async () => {
	const dir = freshDir();
	const files = writeSessions(dir, 20);
	const parent = writeSession(dir, { text: "parent" });
	writeSession(dir, { text: "fork", parentSession: parent.file });
	writeFileSync(join(dir, "junk.jsonl"), "not json\n");
	const first = await listCounting(dir);
	expect(first.listed).toHaveLength(22);
	expect(first.opened.length).toBeGreaterThanOrEqual(23); // every transcript, the junk file, and the parent's header
	const warm = await listCounting(dir);
	expect(warm.listed).toHaveLength(22);
	expect(warm.opened).toEqual([]);
	appendFileSync(files[3], `${JSON.stringify(userEntry("more"))}\n`);
	expect((await listCounting(dir)).opened).toEqual([files[3]]);
});

test("a fork keeps its parent's header id: misleading file names, renamed and archived parents", async () => {
	const dir = freshDir();
	// The parent's file name carries a different UUID than its header.
	const parent = writeSession(dir, { text: "parent", name: `2026-01-01T00-00-00-000Z_${randomUUID()}.jsonl` });
	const fork = writeSession(dir, { text: "fork", parentSession: parent.file });
	const forkedFrom = (listed: Awaited<ReturnType<typeof listWithIndex>>) =>
		listed.find((s) => s.id === fork.id)?.forkedFromId;
	expect(forkedFrom(await listWithIndex(dir))).toBe(parent.id);
	// Renamed after the fork was indexed: the cached id stands, and nothing is opened to serve it.
	renameSync(parent.file, join(dir, `renamed-${randomUUID()}.jsonl`));
	const warm = await listCounting(dir);
	expect(forkedFrom(warm.listed)).toBe(parent.id);
	expect(warm.opened.filter((p) => p === fork.file)).toEqual([]);
	// Archived before the fork is first indexed: the archived location is found.
	const dir2 = freshDir();
	const parent2 = writeSession(dir2, { text: "parent" });
	const fork2 = writeSession(dir2, { text: "fork", parentSession: parent2.file });
	mkdirSync(join(dir2, "archived"));
	renameSync(parent2.file, join(dir2, "archived", basename(parent2.file)));
	expect((await listWithIndex(dir2)).find((s) => s.id === fork2.id)?.forkedFromId).toBe(parent2.id);
});

test("corrupt indexes and entries are rescanned, never trusted: syntax, version, dates, types, extra fields, long titles", async () => {
	const dir = freshDir();
	const files = writeSessions(dir, 5);
	await listWithIndex(dir);
	writeFileSync(indexPath(dir), "{ broken");
	expect(await listWithIndex(dir)).toHaveLength(5);
	writeFileSync(indexPath(dir), JSON.stringify({ version: 99, entries: {} }));
	expect(await listWithIndex(dir)).toHaveLength(5);
	// Valid JSON, matching size and mtime, but each entry wrong in a different way.
	const index = indexOf(dir);
	const entry = (i: number) => index.entries[basename(files[i])];
	entry(0).session.created = "not a date";
	entry(1).session.messageCount = "many";
	entry(2).session.firstMessage = "x".repeat(1_000_000); // an unknown property, however large
	entry(3).session.title = "x".repeat(500); // longer than any title titleOf produces
	entry(4).extra = true; // an unknown property on the entry itself
	writeFileSync(indexPath(dir), JSON.stringify(index));
	const { listed, opened } = await listCounting(dir);
	expect(listed).toHaveLength(5);
	expect(new Set(opened)).toEqual(new Set(files));
	for (const session of listed)
		expect(Object.keys(session).sort()).toEqual(["created", "cwd", "id", "messageCount", "modified", "path", "title"]);
	expect(JSON.stringify(indexOf(dir))).not.toContain("firstMessage");
	const deleted = files[4];
	unlinkSync(deleted);
	expect((await listWithIndex(dir)).map((s) => s.path)).not.toContain(deleted);
	expect(indexOf(dir).entries).not.toHaveProperty(basename(deleted));
});

test("malformed scanned dates skip only their transcript; warm lists open nothing and a repaired file rescans", async () => {
	const dir = freshDir();
	const good = writeSession(dir);
	const bad = writeSession(dir, { timestamp: "not-a-date" });
	const overflow = writeSession(dir);
	const activity = userEntry("overflow activity");
	activity.message.timestamp = 1e100; // valid JSON number, but outside Date's range
	appendFileSync(overflow.file, `${JSON.stringify(activity)}\n`);
	const first = await listCounting(dir);
	expect(first.listed.map((s) => s.id)).toEqual([good.id]);
	expect(first.opened).toHaveLength(3);
	expect(indexOf(dir).entries[basename(bad.file)].session).toBeNull();
	expect(indexOf(dir).entries[basename(overflow.file)].session).toBeNull();
	expect((await listCounting(dir)).opened).toEqual([]);
	// Repair the same header id, making size change so no timestamp-resolution assumption is needed.
	const repairedHeader = {
		type: "session",
		version: 3,
		id: bad.id,
		cwd: dir,
		timestamp: "2026-01-01T00:00:00.000Z",
	};
	writeFileSync(bad.file, `${JSON.stringify(repairedHeader)}\n${JSON.stringify(userEntry("repaired"))}\n`);
	const repaired = await listCounting(dir);
	expect(new Set(repaired.listed.map((s) => s.id))).toEqual(new Set([good.id, bad.id]));
	expect(repaired.opened).toEqual([bad.file]);
});

test("an index larger than the budget is not read", async () => {
	const dir = freshDir();
	const files = writeSessions(dir, 2);
	await listWithIndex(dir);
	const valid = JSON.stringify(indexOf(dir));
	writeFileSync(indexPath(dir), valid + " ".repeat(MAX_INDEX_BYTES)); // valid JSON, over budget
	const { opened } = await listCounting(dir);
	expect(new Set(opened)).toEqual(new Set(files));
});

test("an entry stores a bounded title, not the first message", async () => {
	const dir = freshDir();
	writeSession(dir, { text: "x".repeat(1_000_000) });
	const [session] = await listWithIndex(dir);
	expect([...session.title].length).toBeLessThanOrEqual(201);
	expect(statSync(indexPath(dir)).size).toBeLessThan(2_000);
});

test("a failed index write leaves the listing correct", async () => {
	const dir = freshDir();
	writeSessions(dir, 2);
	mkdirSync(indexPath(dir)); // a directory where the index file belongs: read and rename both fail
	expect(await listWithIndex(dir)).toHaveLength(2);
	expect(await listWithIndex(dir)).toHaveLength(2);
	expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("protocol listing scans directories sequentially with at most 64 transcripts open", async () => {
	const { ctx, agentDir, connect } = await startServer();
	ctx.sessionDir = undefined;
	for (const name of ["first", "second"]) {
		const dir = join(agentDir, "sessions", name);
		mkdirSync(dir, { recursive: true });
		writeSessions(dir, 80);
	}
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>((r) => {
		enter = r;
	});
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const original = SessionModule.buildSessionInfo;
	let active = 0,
		maxActive = 0;
	const scans: string[] = [];
	vi.spyOn(SessionModule, "buildSessionInfo").mockImplementation(async (...args) => {
		active++;
		maxActive = Math.max(maxActive, active);
		scans.push(args[0]);
		if (scans.length === 64) enter();
		try {
			await gate;
			return await original(...args);
		} finally {
			active--;
		}
	});
	const a = await connect();
	const pending = a.client.request("thread/list", {});
	void pending.catch(() => {});
	try {
		await entered;
		expect(scans).toHaveLength(64);
		expect(active).toBe(64);
		expect(new Set(scans.map((path) => dirname(path))).size).toBe(1);
		release();
		await pending;
		expect(scans).toHaveLength(160);
		expect(maxActive).toBeLessThanOrEqual(64);
	} finally {
		release();
	}
});
