// The bot object's own tables share one SQLite database with the durable harness. Durable runs its commits as async
// transactions through a queue (packages/chord's DurableObjectSqliteDatabase); a write made straight to ctx.storage.sql
// while one is open would join it and roll back with it. Host writes therefore go through the same queue, each as its
// own transaction: never inside one of durable's, and atomic in itself. Reads may stay direct.
import { DurableObjectSqliteDatabase } from "@knightcode/chord/sqlite/cloudflare";

/** Runs `fn`'s statements as one queued transaction. Plain functions of `sql` stay testable with an immediate writer. */
export type HostWrite = <T>(fn: (sql: SqlStorage) => T) => Promise<T>;

/** For stores used outside a harness (tests, objects without durable): write at once. */
export const immediateWrite =
	(sql: SqlStorage): HostWrite =>
	(fn) =>
		Promise.resolve(fn(sql));

export function queuedWrite(storage: DurableObjectStorage): HostWrite {
	const db = new DurableObjectSqliteDatabase(storage as never);
	return (fn) => db.transaction(async () => fn(storage.sql));
}
