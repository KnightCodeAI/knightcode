import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "./database.ts";
import { SqliteStorage } from "./storage.ts";

/** Node SQLite connection settings for a durable storage file. */
export type NodeSqliteStorageOptions = {
	/** SQLite WAL auto-checkpoint threshold. SQLite and this adapter default to 1,000 pages; 0 disables it. */
	readonly walAutoCheckpointPages?: number;
	/** Time SQLite waits for a competing file lock. SQLite defaults to 0; this adapter defaults to 5,000 ms. */
	readonly busyTimeoutMs?: number;
};

const DEFAULT_WAL_AUTO_CHECKPOINT_PAGES = 1_000;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

type TransactionScope = { active: boolean };

/** A prepared statement of a synchronous SQLite driver, as this adapter uses it. */
export interface SyncSqliteStatement {
	run(...params: SqliteValue[]): unknown;
	get(...params: SqliteValue[]): unknown;
	all(...params: SqliteValue[]): unknown[];
}

/**
 * A synchronous SQLite connection, as this adapter uses it. `node:sqlite`'s `DatabaseSync` is one; the Bun
 * adapter wraps `bun:sqlite` into one.
 */
export interface SyncSqliteConnection {
	exec(sql: string): void;
	prepare(sql: string): SyncSqliteStatement;
	close(): void;
}

const ignore = (): void => {};

/**
 * Runs operations in call order. An operation starts immediately when nothing is running or waiting;
 * otherwise it waits for everything before it. An asynchronous operation holds the queue until it settles.
 */
class SerialOperationQueue {
	private tail: Promise<void> = Promise.resolve();
	private pending = 0;

	run<T>(operation: () => T): Promise<T> {
		if (this.pending > 0) return this.enqueue(operation);
		try {
			return Promise.resolve(operation());
		} catch (error) {
			return Promise.reject(error);
		}
	}

	runAsync<T>(operation: () => Promise<T>): Promise<T> {
		if (this.pending > 0) return this.enqueue(operation);
		this.pending++;
		// Publish the barrier before the operation starts, so calls it makes synchronously wait behind it.
		const { promise: barrier, resolve: releaseBarrier } = Promise.withResolvers<void>();
		this.tail = barrier;
		let started: Promise<T>;
		try {
			started = operation();
		} catch (error) {
			started = Promise.reject(error);
		}
		return started.finally(() => {
			this.pending--;
			releaseBarrier();
		});
	}

	private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
		this.pending++;
		return this.release(this.tail.then(operation));
	}

	private release<T>(operation: Promise<T>): Promise<T> {
		const settled = operation.finally(() => {
			this.pending--;
		});
		this.tail = settled.then(ignore, ignore);
		return settled;
	}
}

/**
 * Executes SQL on one connection. Prepared statements are cached per connection by SQL text, so the
 * database and its transaction handles share them across transactions.
 */
abstract class NodeSqliteExecutor implements SqliteExecutor {
	protected readonly database: SyncSqliteConnection;
	protected readonly statements: Map<string, SyncSqliteStatement>;

	constructor(database: SyncSqliteConnection, statements: Map<string, SyncSqliteStatement>) {
		this.database = database;
		this.statements = statements;
	}

	exec(sql: string): Promise<void> {
		return this.runOperation(() => {
			this.database.exec(sql);
		});
	}

	run(sql: string, ...params: SqliteValue[]): Promise<void> {
		return this.runOperation(() => {
			this.statement(sql).run(...params);
		});
	}

	get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return this.runOperation(() => this.statement(sql).get(...params) as T | undefined);
	}

	all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return this.runOperation(() => this.statement(sql).all(...params) as T[]);
	}

	protected abstract runOperation<T>(operation: () => T): Promise<T>;

	private statement(sql: string): SyncSqliteStatement {
		let statement = this.statements.get(sql);
		if (statement === undefined) {
			statement = this.database.prepare(sql);
			this.statements.set(sql, statement);
		}
		return statement;
	}
}

class NodeSqliteTransaction extends NodeSqliteExecutor {
	private readonly scope: TransactionScope;

	constructor(database: SyncSqliteConnection, statements: Map<string, SyncSqliteStatement>, scope: TransactionScope) {
		super(database, statements);
		this.scope = scope;
	}

	protected async runOperation<T>(operation: () => T): Promise<T> {
		if (!this.scope.active) throw new Error("SQLite transaction handle is no longer active");
		return operation();
	}
}

/**
 * `SqliteDatabase` adapter over a synchronous SQLite connection: Node's built-in `node:sqlite`, or `bun:sqlite`
 * through the Bun adapter.
 */
export class NodeSqliteDatabase extends NodeSqliteExecutor implements SqliteDatabase {
	private readonly access = new SerialOperationQueue();
	private closed = false;

	constructor(database: SyncSqliteConnection) {
		super(database, new Map());
	}

	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.access.runAsync(async () => {
			this.database.exec("BEGIN IMMEDIATE");
			const scope = { active: true };
			try {
				const result = await callback(new NodeSqliteTransaction(this.database, this.statements, scope));
				scope.active = false;
				this.database.exec("COMMIT");
				return result;
			} catch (error) {
				scope.active = false;
				try {
					this.database.exec("ROLLBACK");
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], "SQLite transaction failed and rollback failed");
				}
				throw error;
			}
		});
	}

	close(): Promise<void> {
		return this.access.run(() => {
			if (this.closed) return;
			this.closed = true;
			this.statements.clear();
			try {
				this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			} finally {
				this.database.close();
			}
		});
	}

	protected runOperation<T>(operation: () => T): Promise<T> {
		return this.access.run(operation);
	}
}

/**
 * Configure a freshly opened connection for durable storage: WAL journaling, NORMAL sync and the WAL
 * auto-checkpoint threshold. Closes the connection when configuration fails.
 */
export async function configureSqliteDatabase(
	connection: SyncSqliteConnection,
	options: NodeSqliteStorageOptions = {},
): Promise<NodeSqliteDatabase> {
	const checkpointPages = options.walAutoCheckpointPages ?? DEFAULT_WAL_AUTO_CHECKPOINT_PAGES;
	const adapter = new NodeSqliteDatabase(connection);
	try {
		await adapter.exec("PRAGMA journal_mode = WAL");
		await adapter.exec("PRAGMA synchronous = NORMAL");
		await adapter.exec(`PRAGMA wal_autocheckpoint = ${checkpointPages}`);
		return adapter;
	} catch (error) {
		try {
			await adapter.close();
		} catch {
			// Preserve the configuration failure.
		}
		throw error;
	}
}

/** Create the parent directory of a database file; `:memory:` has none. */
export async function prepareSqlitePath(path: string): Promise<void> {
	if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
}

/** Default time SQLite waits for a competing file lock, in milliseconds. */
export function sqliteBusyTimeoutMs(options: NodeSqliteStorageOptions): number {
	return options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
}

/** Open and configure a Node-backed SQLite database facade. */
export async function openNodeSqliteDatabase(
	path: string,
	options: NodeSqliteStorageOptions = {},
): Promise<NodeSqliteDatabase> {
	await prepareSqlitePath(path);
	// Loaded on use rather than imported: Bun has no `node:sqlite`, and a static import would fail any Bun
	// process that merely loads this module, including a compiled binary that bundles it.
	const { DatabaseSync: Database } = createRequire(import.meta.url)("node:sqlite") as {
		DatabaseSync: typeof DatabaseSync;
	};
	return configureSqliteDatabase(new Database(path, { timeout: sqliteBusyTimeoutMs(options) }), options);
}

/** Open or create file-backed durable storage using Node's built-in SQLite. */
export async function openNodeSqliteStorage(
	path: string,
	options: NodeSqliteStorageOptions = {},
): Promise<SqliteStorage> {
	return SqliteStorage.open(await openNodeSqliteDatabase(path, options));
}
