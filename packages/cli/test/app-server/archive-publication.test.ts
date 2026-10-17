import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import * as promises from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, expect, test, vi } from "vitest";
import { moveSessionFileWithoutReplace } from "../../src/app-server/session-files.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

vi.mock("node:fs/promises", { spy: true });
const dirs: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "kc-archive-publish-"));
	dirs.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: "hello", timestamp: 0 });
	const source = manager.getSessionFile()!;
	const id = manager.getSessionId();
	manager.close();
	return { source, id, destination: join(dir, "archived", "saved.jsonl"), before: readFileSync(source, "utf8") };
}

test("archive refuses an existing destination without changing either transcript", async () => {
	const { source, id, destination, before } = fixture();
	await promises.mkdir(join(destination, ".."), { recursive: true });
	writeFileSync(destination, "unrelated");
	await expect(moveSessionFileWithoutReplace(source, destination, id, () => {})).rejects.toMatchObject({
		code: "archiveConflict",
	});
	expect(readFileSync(source, "utf8")).toBe(before);
	expect(readFileSync(destination, "utf8")).toBe("unrelated");
	expect(lockfile.checkSync(source, { realpath: false })).toBe(false);
	expect(lockfile.checkSync(destination, { realpath: false })).toBe(false);
});

test("publication and index update hold both locks and leave one transcript", async () => {
	const { source, id, destination, before } = fixture();
	await moveSessionFileWithoutReplace(source, destination, id, () => {
		expect(lockfile.checkSync(source, { realpath: false })).toBe(true);
		expect(lockfile.checkSync(destination, { realpath: false })).toBe(true);
		expect(existsSync(source)).toBe(false);
		expect(readFileSync(destination, "utf8")).toBe(before);
	});
	expect(existsSync(source)).toBe(false);
	expect(readFileSync(destination, "utf8")).toBe(before);
	expect(lockfile.checkSync(destination, { realpath: false })).toBe(false);
});

test("destination creation after the absence check cannot overwrite it", async () => {
	const { source, id, destination, before } = fixture();
	const actual = await vi.importActual<typeof FsPromises>("node:fs/promises");
	vi.mocked(promises.link).mockImplementationOnce(async (from, to) => {
		writeFileSync(String(to), "raced");
		await actual.link(from, to);
	});
	await expect(moveSessionFileWithoutReplace(source, destination, id, () => {})).rejects.toMatchObject({
		code: "archiveConflict",
	});
	expect(readFileSync(source, "utf8")).toBe(before);
	expect(readFileSync(destination, "utf8")).toBe("raced");
});

test("unlink failure rolls back only its own destination; rollback failure reports both recoverable paths", async () => {
	const { source, id, destination, before } = fixture();
	vi.mocked(promises.unlink).mockRejectedValueOnce(new Error("unlink source failed"));
	await expect(moveSessionFileWithoutReplace(source, destination, id, () => {})).rejects.toMatchObject({
		code: "archiveConflict",
	});
	expect(readFileSync(source, "utf8")).toBe(before);
	expect(existsSync(destination)).toBe(false);
	vi.mocked(promises.unlink)
		.mockRejectedValueOnce(new Error("unlink source failed"))
		.mockRejectedValueOnce(new Error("rollback failed"));
	await expect(moveSessionFileWithoutReplace(source, destination, id, () => {})).rejects.toMatchObject({
		code: "archiveConflict",
		data: { reason: "rollbackFailed", paths: [source, destination] },
	});
	expect(readFileSync(source, "utf8")).toBe(before);
	expect(readFileSync(destination, "utf8")).toBe(before);
});

test("index failure after publication preserves the sole surviving transcript", async () => {
	const { source, id, destination, before } = fixture();
	await expect(
		moveSessionFileWithoutReplace(source, destination, id, () => {
			throw new Error("index failed");
		}),
	).rejects.toMatchObject({ code: "archiveConflict", data: { reason: "indexUpdateFailed", paths: [destination] } });
	expect(existsSync(source)).toBe(false);
	expect(readFileSync(destination, "utf8")).toBe(before);
});
