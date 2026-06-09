import type { Database } from "bun:sqlite";
import type { Migration } from "./migrations";

function countLegacyMigrations(db: Database): number {
  const exists = db
    .query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
    )
    .get();
  if (!exists) return 0;
  const row = db
    .query(`SELECT COUNT(*) AS c FROM __drizzle_migrations`)
    .get() as { c: number };
  return row.c;
}

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

  // One-time adoption of a DB created by the previous (drizzle) migrator: if our
  // tracking table is empty but a legacy __drizzle_migrations table records N
  // applied migrations, the first N of ours (same files, same order) are already
  // applied — record them without re-running so the existing schema isn't
  // recreated. Anything beyond N applies normally below. Fresh DBs skip this.
  if (applied.size === 0) {
    const legacyCount = countLegacyMigrations(db);
    const adoptCount = Math.min(legacyCount, sorted.length);
    if (adoptCount > 0) {
      const adopt = db.transaction(() => {
        for (let i = 0; i < adoptCount; i++) {
          const m = sorted[i]!;
          db.run(`INSERT INTO ${TABLE} (id, hash) VALUES (?, ?)`, [
            m.id,
            m.hash,
          ]);
          applied.set(m.id, m.hash);
        }
      });
      adopt();
    }
  }

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

    const apply = db.transaction(() => {
      db.exec(m.sql);
      db.run(`INSERT INTO ${TABLE} (id, hash) VALUES (?, ?)`, [m.id, m.hash]);
    });
    apply();
  }
}
