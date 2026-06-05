import type { Database } from "bun:sqlite";
import type { Migration } from "./migrations";

const TABLE = "__knightcode_migrations";

/**
 * Apply pending migrations against a raw bun:sqlite Database. Each unapplied
 * migration runs inside an explicit transaction: if its SQL throws, the whole
 * migration is rolled back and its row is never inserted, so the db never lands
 * in a half-migrated state. Already-applied ids are verified by hash to catch a
 * db written by an incompatible build.
 */
export function runMigrations(db: Database, migrations: Migration[]): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, hash TEXT NOT NULL);`,
  );

  const applied = new Map<string, string>();
  for (const row of db.query(`SELECT id, hash FROM ${TABLE}`).all() as {
    id: string;
    hash: string;
  }[]) {
    applied.set(row.id, row.hash);
  }

  const sorted = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  for (const m of sorted) {
    const existingHash = applied.get(m.id);
    if (existingHash !== undefined) {
      if (existingHash !== m.hash) {
        throw new Error(
          `Migration ${m.id} hash mismatch — database may be from an incompatible version`,
        );
      }
      continue;
    }

    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.run(`INSERT INTO ${TABLE} (id, hash) VALUES (?, ?)`, [m.id, m.hash]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
