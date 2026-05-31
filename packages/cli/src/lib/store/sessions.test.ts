import { describe, expect, test } from "bun:test";
import { createStore } from "./client";
import {
  createSession,
  deleteSession,
  directorySessionStats,
  getSession,
  listSessions,
  renameSession,
  setSessionReasoningEffort,
  touchSession,
} from "./sessions";
import { appendMessage } from "./messages";

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

  test("touchSession bumps timeUpdated (drives listSessions ordering)", async () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/p", title: "x" });
    const before = getSession(db, s.id)!.timeUpdated;
    await Bun.sleep(5); // guarantee the clock advances past ms granularity
    touchSession(db, s.id);
    expect(getSession(db, s.id)!.timeUpdated).toBeGreaterThan(before);
  });
});

describe("setSessionReasoningEffort", () => {
  test("updates the session's reasoning effort", () => {
    const db = createStore(":memory:");
    const row = createSession(db, { directory: "/proj", title: "T" });
    setSessionReasoningEffort(db, row.id, "high");
    expect(getSession(db, row.id)?.reasoningEffort).toBe("high");
  });
});

describe("directorySessionStats", () => {
  test("aggregates token totals and message counts per session, scoped to directory", () => {
    const db = createStore(":memory:");
    const a = createSession(db, {
      directory: "/proj",
      title: "A",
      model: "z-ai/glm-4.5-air:free",
    });
    createSession(db, { directory: "/other", title: "B" });
    appendMessage(db, {
      id: "m1",
      sessionId: a.id,
      role: "assistant",
      parts: [],
      inputTokens: 10,
      outputTokens: 5,
    });
    appendMessage(db, {
      id: "m2",
      sessionId: a.id,
      role: "assistant",
      parts: [],
      inputTokens: 3,
      outputTokens: 2,
    });

    const rows = directorySessionStats(db, "/proj");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe("z-ai/glm-4.5-air:free");
    expect(rows[0]?.inputTokens).toBe(13);
    expect(rows[0]?.outputTokens).toBe(7);
    expect(rows[0]?.messageCount).toBe(2);
  });
});
