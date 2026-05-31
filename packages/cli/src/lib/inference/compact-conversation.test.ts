import { describe, expect, test } from "bun:test";
import { compactConversation } from "./compact-conversation";

function uiMsg(id: string, role: "user" | "assistant", text: string) {
  return { id, role, parts: [{ type: "text", text }], metadata: {} } as any;
}

describe("compactConversation", () => {
  test("returns input unchanged when there are 4 or fewer messages", async () => {
    const msgs = [uiMsg("a", "user", "1"), uiMsg("b", "assistant", "2")];
    const res = await compactConversation({
      messages: msgs,
      model: "z-ai/glm-4.5-air:free",
      mode: "BUILD",
      summarize: async () => "SUMMARY",
    });
    expect(res.compactedMessages).toBe(msgs);
  });

  test("summarizes everything before the last 4 and preserves the tail", async () => {
    const msgs = [
      uiMsg("m1", "user", "one"),
      uiMsg("m2", "assistant", "two"),
      uiMsg("m3", "user", "three"),
      uiMsg("m4", "assistant", "four"),
      uiMsg("m5", "user", "five"),
      uiMsg("m6", "assistant", "six"),
    ];
    const res = await compactConversation({
      messages: msgs,
      model: "z-ai/glm-4.5-air:free",
      mode: "BUILD",
      summarize: async () => "ENGINEERING STATE SUMMARY",
    });
    // 1 summary + last 4 preserved
    expect(res.compactedMessages.length).toBe(5);
    const summary = res.compactedMessages[0]!;
    expect(summary.metadata?.isCompaction).toBe(true);
    expect(summary.metadata?.summaryCount).toBe(1);
    expect(summary.metadata?.preservedCount).toBe(4);
    expect(summary.metadata?.originalMessageCount).toBe(6);
    expect((summary.parts[0] as any).text).toBe("ENGINEERING STATE SUMMARY");
    // tail preserved by id
    expect(res.compactedMessages.slice(1).map((m) => m.id)).toEqual([
      "m3",
      "m4",
      "m5",
      "m6",
    ]);
  });
});
