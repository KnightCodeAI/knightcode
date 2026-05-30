import { describe, expect, test } from "bun:test";
import { createStore } from "./client";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  renameSession,
} from "./sessions";

describe("session store", () => {
  test("create + get round-trips with defaults", () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/proj", title: "Hello" });
    expect(s.id).toBeTruthy();
    const got = getSession(db, s.id);
    expect(got?.title).toBe("Hello");
    expect(got?.directory).toBe("/proj");
    expect(got?.reasoningEffort).toBe("medium");
    expect(got?.model).toBeNull();
  });

  test("listSessions filters by directory", () => {
    const db = createStore(":memory:");
    createSession(db, { id: "a", directory: "/x", title: "A" });
    createSession(db, { id: "b", directory: "/y", title: "B" });
    createSession(db, { id: "c", directory: "/x", title: "C" });
    const xs = listSessions(db, "/x");
    expect(xs.length).toBe(2);
    expect(new Set(xs.map((s) => s.id))).toEqual(new Set(["a", "c"]));
  });

  test("renameSession updates title", () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/p", title: "Old" });
    renameSession(db, s.id, "New");
    expect(getSession(db, s.id)?.title).toBe("New");
  });

  test("deleteSession removes the row", () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/p", title: "x" });
    deleteSession(db, s.id);
    expect(getSession(db, s.id)).toBeNull();
  });
});
