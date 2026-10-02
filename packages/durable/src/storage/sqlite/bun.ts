import { createRequire } from "node:module";
import type { SqliteValue } from "./database.ts";
import {
	configureSqliteDatabase,
	type NodeSqliteDatabase,
	type NodeSqliteStorageOptions,
	prepareSqlitePath,
	type SyncSqliteConnection,
	sqliteBusyTimeoutMs,
} from "./node.ts";
import { SqliteStorage } from "./storage.ts";

/** The part of `bun:sqlite` this adapter uses. Declared here so the package needs no Bun type definitions. */
interface BunStatement {
	run(...params: SqliteValue[]): unknown;
	get(...params: SqliteValue[]): unknown;
	all(...params: SqliteValue[]): unknown[];
	finalize(): void;
}

interface BunDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): BunStatement;
	close(): void;
}

type BunDatabaseConstructor = new (path: string) => BunDatabase;

/** Bun SQLite connection settings for a durable storage file; the same settings as the Node adapter. */
export type BunSqliteStorageOptions = NodeSqliteStorageOptions;

/** Present a `bun:sqlite` database as the synchronous connection the shared adapter drives. */
function toSyncConnection(database: BunDatabase): SyncSqliteConnection {
	const statements: BunStatement[] = [];
	return {
		exec(sql) {
			database.exec(sql);
		},
		prepare(sql) {
			const statement = database.prepare(sql);
			statements.push(statement);
			return {
				run: (...params) => statement.run(...params),
				// bun:sqlite returns null for no row; node:sqlite, and the adapter, use undefined.
				get: (...params) => statement.get(...params) ?? undefined,
				all: (...params) => statement.all(...params),
			};
		},
		close() {
			// bun:sqlite defers closing while prepared statements are alive, which keeps the file locked.
			for (const statement of statements.splice(0)) statement.finalize();
			database.close();
		},
	};
}

/** Open and configure a Bun-backed SQLite database facade. */
export async function openBunSqliteDatabase(
	path: string,
	options: BunSqliteStorageOptions = {},
): Promise<NodeSqliteDatabase> {
	await prepareSqlitePath(path);
	// Loaded on use rather than imported, so Node can load this module without failing on `bun:sqlite`.
	const { Database } = createRequire(import.meta.url)("bun:sqlite") as { Database: BunDatabaseConstructor };
	const database = new Database(path);
	try {
		database.exec(`PRAGMA busy_timeout = ${sqliteBusyTimeoutMs(options)}`);
	} catch (error) {
		database.close();
		throw error;
	}
	return configureSqliteDatabase(toSyncConnection(database), options);
}

/** Open or create file-backed durable storage using Bun's built-in SQLite. */
export async function openBunSqliteStorage(
	path: string,
	options: BunSqliteStorageOptions = {},
): Promise<SqliteStorage> {
	return SqliteStorage.open(await openBunSqliteDatabase(path, options));
}
