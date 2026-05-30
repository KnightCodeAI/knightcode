import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { knightcodeHome } from "../paths";
import * as schema from "./schema";

export type Store = BunSQLiteDatabase<typeof schema>;

export function getDefaultDbPath(): string {
  return join(knightcodeHome(), "knightcode.db");
}

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

/**
 * Open (creating if needed) the local sqlite store and apply pending
 * migrations. Pass ":memory:" for an ephemeral test db. bun:sqlite and the
 * bun-sqlite migrator are synchronous, so this returns a ready db.
 */
export function createStore(dbPath: string = getDefaultDbPath()): Store {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(dbPath, { create: true });
  // Tighten the db file (session/message history) to owner-only. The parent dir
  // is already 0700; this is defense-in-depth (POSIX; skipped on Windows).
  if (dbPath !== ":memory:" && process.platform !== "win32") {
    chmodSync(dbPath, 0o600);
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}
