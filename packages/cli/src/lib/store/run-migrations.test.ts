import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./run-migrations";
import type { Migration } from "./migrations";

const M = (id: string, sql: string): Migration => ({
  id,
  sql,
  hash: `hash-${id}`,
});

describe("runMigrations", () => {
  test("applies a migration and records it", () => {
    const db = new Database(":memory:");
    runMigrations(db, [M("0001", "CREATE TABLE a (x INTEGER);")]);
    const rows = db
      .query("SELECT id, hash FROM __knightcode_migrations")
      .all() as { id: string; hash: string }[];
    expect(rows).toEqual([{ id: "0001", hash: "hash-0001" }]);
    // table really exists
    db.exec("INSERT INTO a (x) VALUES (1);");
  });

  test("is idempotent — second run applies nothing new", () => {
    const db = new Database(":memory:");
    const migs = [M("0001", "CREATE TABLE a (x INTEGER);")];
    runMigrations(db, migs);
    runMigrations(db, migs); // must not throw "table a already exists"
    const count = db
      .query("SELECT COUNT(*) AS n FROM __knightcode_migrations")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  test("throws on hash mismatch for an applied id", () => {
    const db = new Database(":memory:");
    runMigrations(db, [M("0001", "CREATE TABLE a (x INTEGER);")]);
    expect(() =>
      runMigrations(db, [
        { id: "0001", hash: "DIFFERENT", sql: "CREATE TABLE a (x INTEGER);" },
      ]),
    ).toThrow(/hash mismatch/);
  });

  test("rolls back a failed migration — nothing recorded, db unchanged", () => {
    const db = new Database(":memory:");
    expect(() =>
      runMigrations(db, [
        M("0001", "CREATE TABLE a (x INTEGER); INSERT INTO nope VALUES (1);"),
      ]),
    ).toThrow();
    const recorded = db
      .query("SELECT COUNT(*) AS n FROM __knightcode_migrations")
      .get() as { n: number };
    expect(recorded.n).toBe(0);
    // The CREATE TABLE a from the failed migration must have been rolled back.
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='a'")
      .all();
    expect(tables).toEqual([]);
  });

  test("applies migrations in id order regardless of input order", () => {
    const db = new Database(":memory:");
    runMigrations(db, [
      M("0002", "CREATE TABLE b (y INTEGER);"),
      M("0001", "CREATE TABLE a (x INTEGER);"),
    ]);
    const ids = (
      db.query("SELECT id FROM __knightcode_migrations ORDER BY id").all() as {
        id: string;
      }[]
    ).map((r) => r.id);
    expect(ids).toEqual(["0001", "0002"]);
  });
});
