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
	const changed = [
		await db.runCounted("UPDATE t SET v = v || '!'"),
		await db.runCounted("DELETE FROM t WHERE id = ?", 99),
	];
	await db.close();

	const storagePath = join(dir, "storage.sqlite");
	await (await openBunSqliteStorage(storagePath)).close(BACKGROUND_CONTEXT);
	await (await openBunSqliteStorage(storagePath)).close(BACKGROUND_CONTEXT);

	const prefixedPath = join(dir, "prefixed.sqlite");
	await (await openBunSqliteStorage(prefixedPath, { prefix: "kc_" })).close(BACKGROUND_CONTEXT);
	const prefixedDb = await openBunSqliteDatabase(prefixedPath);
	const prefixedTables = await prefixedDb.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
	await prefixedDb.close();
	const prefixed = prefixedTables.length > 0 && prefixedTables.every((table) => table.name.startsWith("kc_"));

	console.log(
		JSON.stringify({
			missing: missing === undefined,
			journal: journal?.journal_mode,
			rollbackError,
			rows: rows.map((row) => row.v),
			changed,
			prefixed,
		}),
	);
} finally {
	// Fails with EBUSY on Windows when a closed database still holds its file.
	rmSync(dir, { recursive: true });
}
