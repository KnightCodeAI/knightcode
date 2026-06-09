import { describe, expect, test } from "bun:test";
import { readMigrationsFromDisk } from "./migrations";

describe("readMigrationsFromDisk", () => {
  test("reads the real migration directory", () => {
    const migrations = readMigrationsFromDisk();
    expect(migrations.length).toBeGreaterThan(0);
    const first = migrations[0]!;
    expect(first.id).toMatch(/^\d{4}_/);
    expect(first.sql).toContain("CREATE TABLE");
    // sha-256 hex digest is 64 chars
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is sorted by id", () => {
    const ids = readMigrationsFromDisk().map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
  });
});
