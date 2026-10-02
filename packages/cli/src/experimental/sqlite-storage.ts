import type { SqliteStorage } from "@knightcode/durable/storage/sqlite";
import { openBunSqliteStorage } from "@knightcode/durable/storage/sqlite/bun";
import { openNodeSqliteStorage } from "@knightcode/durable/storage/sqlite/node";

/**
 * Open file-backed durable storage with the running runtime's built-in SQLite. The compiled binary runs on Bun,
 * which has `bun:sqlite` but no `node:sqlite`; source runs under Node use `node:sqlite`.
 */
export function openSqliteStorage(path: string): Promise<SqliteStorage> {
	return process.versions.bun ? openBunSqliteStorage(path) : openNodeSqliteStorage(path);
}
