// Run by sqlite-bun.test.ts under the `bun` executable: Vitest runs on Node, which has no `bun:sqlite`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@knightcode/chord/context";
import { openBunSqliteDatabase, openBunSqliteStorage } from "../../src/storage/sqlite/bun.ts";

const dir = mkdtempSync(join(tmpdir(), "knightcode-bun-sqlite-"));
try {
	const db = await openBunSqliteDatabase(join(dir, "nested", "facade.sqlite"));
	await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); CREATE TABLE u (x TEXT);");
	await db.run("INSERT INTO t (v) VALUES (?)", "a");
	const missing = await db.get("SELECT * FROM t WHERE id = ?", 99);
	const journal = await db.get<{ journal_mode: string }>("PRAGMA journal_mode");
	await db.transaction(async (transaction) => {
		await transaction.run("INSERT INTO t (v) VALUES (?)", "b");
	});
	let rollbackError: string | undefined;
	try {
		await db.transaction(async (transaction) => {
			await transaction.run("INSERT INTO t (v) VALUES (?)", "rolled back");
			throw new Error("boom");
		});
	} catch (error) {
		rollbackError = (error as Error).message;
	}
	const rows = await db.all<{ v: string }>("SELECT v FROM t ORDER BY id");
	await db.close();

	const storagePath = join(dir, "storage.sqlite");
	await (await openBunSqliteStorage(storagePath)).close(BACKGROUND_CONTEXT);
	await (await openBunSqliteStorage(storagePath)).close(BACKGROUND_CONTEXT);

	console.log(
		JSON.stringify({
			missing: missing === undefined,
			journal: journal?.journal_mode,
			rollbackError,
			rows: rows.map((row) => row.v),
		}),
	);
} finally {
	// Fails with EBUSY on Windows when a closed database still holds its file.
	rmSync(dir, { recursive: true });
}
