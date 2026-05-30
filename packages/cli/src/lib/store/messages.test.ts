import { describe, expect, test } from "bun:test";
import { createStore } from "./client";
import { createSession, deleteSession } from "./sessions";
import {
  appendMessage,
  getMessages,
  sessionUsage,
  updateMessage,
} from "./messages";

describe("message store", () => {
  test("append assigns increasing ord; getMessages returns in order; JSON round-trips", () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/p", title: "t" });
    appendMessage(db, {
      id: "m1",
      sessionId: s.id,
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    });
    appendMessage(db, {
      id: "m2",
      sessionId: s.id,
      role: "assistant",
      parts: [{ type: "text", text: "yo" }],
      inputTokens: 10,
      outputTokens: 5,
    });
    const msgs = getMessages(db, s.id);
    expect(msgs.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(msgs[0]!.ord).toBe(1);
    expect(msgs[1]!.ord).toBe(2);
    expect(msgs[1]!.parts).toEqual([{ type: "text", text: "yo" }]);
  });

  test("updateMessage patches parts and status", () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/p", title: "t" });
    appendMessage(db, {
      id: "m1",
      sessionId: s.id,
      role: "assistant",
      parts: [],
      status: "streaming",
    });
    updateMessage(db, "m1", {
      parts: [{ type: "text", text: "done" }],
      status: "complete",
    });
    const [m] = getMessages(db, s.id);
    expect(m!.status).toBe("complete");
    expect(m!.parts).toEqual([{ type: "text", text: "done" }]);
  });

  test("sessionUsage sums tokens and counts", () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/p", title: "t" });
    appendMessage(db, { id: "m1", sessionId: s.id, role: "user", parts: [] });
    appendMessage(db, {
      id: "m2",
      sessionId: s.id,
      role: "assistant",
      parts: [],
      inputTokens: 10,
      outputTokens: 5,
    });
    const usage = sessionUsage(db, s.id);
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(5);
    expect(usage.messageCount).toBe(2);
  });

  test("deleting a session cascades its messages", () => {
    const db = createStore(":memory:");
    const s = createSession(db, { directory: "/p", title: "t" });
    appendMessage(db, { id: "m1", sessionId: s.id, role: "user", parts: [] });
    deleteSession(db, s.id);
    expect(getMessages(db, s.id)).toEqual([]);
  });
});
