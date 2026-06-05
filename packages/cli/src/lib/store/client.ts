import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { knightcodeHome } from "../paths";
import { loadMigrations } from "./migrations";
import { runMigrations } from "./run-migrations";
import * as schema from "./schema";

export type Store = BunSQLiteDatabase<typeof schema>;

export function getDefaultDbPath(): string {
  return join(knightcodeHome(), "knightcode.db");
}

/**
 * Open (creating if needed) the local sqlite store and apply pending
 * migrations. Pass ":memory:" for an ephemeral test db. bun:sqlite and the
 * inline migration runner are synchronous, so this returns a ready db.
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
  runMigrations(sqlite, loadMigrations());
  return drizzle(sqlite, { schema });
}

let cachedStore: Store | undefined;

/** Process-wide lazy singleton over the default db path. */
export function getStore(): Store {
  if (!cachedStore) cachedStore = createStore();
  return cachedStore;
}
