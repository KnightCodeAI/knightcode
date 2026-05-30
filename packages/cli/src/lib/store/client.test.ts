import { describe, expect, test } from "bun:test";
import { createStore, getDefaultDbPath } from "./client";
import { sessionTable } from "./schema";

describe("store client", () => {
  test("createStore(:memory:) opens a migrated db with empty tables", () => {
    const db = createStore(":memory:");
    const rows = db.select().from(sessionTable).all();
    expect(rows).toEqual([]);
  });

  test("getDefaultDbPath ends with knightcode.db", () => {
    expect(getDefaultDbPath().endsWith("knightcode.db")).toBe(true);
  });
});
