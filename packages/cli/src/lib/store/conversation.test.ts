import { describe, expect, test } from "bun:test";
import { createStore } from "./client";
import { getSession } from "./sessions";
import {
  ensureSession,
  loadConversation,
  replaceSessionMessages,
} from "./conversation";

type Msg = {
  id: string;
  role: "user" | "assistant";
  parts: any[];
  metadata?: Record<string, unknown>;
};

describe("conversation adapter", () => {
  test("ensureSession is idempotent and seeds a row", () => {
    const db = createStore(":memory:");
    ensureSession(db, { id: "s1", directory: "/p", title: "T" });
    ensureSession(db, { id: "s1", directory: "/p", title: "CHANGED" });
    // second call must not throw, seeds no messages...
    expect(loadConversation(db, "s1")).toEqual([]);
    // ...and must not overwrite the original title (onConflictDoNothing).
    expect(getSession(db, "s1")?.title).toBe("T");
  });

  test("replace then load round-trips messages in order", () => {
    const db = createStore(":memory:");
    ensureSession(db, { id: "s1", directory: "/p", title: "T" });
    const msgs: Msg[] = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
        metadata: { usage: { inputTokens: 10, outputTokens: 5 } },
      },
    ];
    replaceSessionMessages(db, "s1", msgs as any);
    const loaded = loadConversation(db, "s1");
    expect(loaded.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(loaded[1]!.role).toBe("assistant");
    expect((loaded[1]!.parts[0] as any).text).toBe("hello");
    // metadata round-trips through the JSON column.
    const usage = (loaded[1]!.metadata as any)?.usage;
    expect(usage?.inputTokens).toBe(10);
    expect(usage?.outputTokens).toBe(5);
  });

  test("replace overwrites prior contents (clear via empty array)", () => {
    const db = createStore(":memory:");
    ensureSession(db, { id: "s1", directory: "/p", title: "T" });
    replaceSessionMessages(db, "s1", [
      { id: "m1", role: "user", parts: [] },
    ] as any);
    replaceSessionMessages(db, "s1", []);
    expect(loadConversation(db, "s1")).toEqual([]);
  });

  test("loadConversation drops rows persisted with status 'error'", () => {
    const db = createStore(":memory:");
    ensureSession(db, { id: "s1", directory: "/p", title: "T" });
    replaceSessionMessages(db, "s1", [
      { id: "ok", role: "user", parts: [] },
      {
        id: "bad",
        role: "assistant",
        parts: [],
        metadata: { __status: "error" },
      },
    ] as any);
    // 'bad' carries the error sentinel and must be filtered on load
    expect(loadConversation(db, "s1").map((m) => m.id)).toEqual(["ok"]);
  });
});
