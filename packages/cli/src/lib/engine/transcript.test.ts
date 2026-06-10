import { describe, expect, test } from "bun:test";
import { repairTranscript } from "./transcript";
import type { Message } from "./messages";

const user = (text: string): Message =>
  ({ id: "u1", role: "user", parts: [{ type: "text", text }] }) as Message;

describe("repairTranscript", () => {
  test("returns healthy transcripts unchanged (same references)", () => {
    const msgs: Message[] = [
      user("hi"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "done" },
          {
            type: "tool-Read",
            toolCallId: "t1",
            state: "output-available",
            input: { file_path: "x" },
            output: { content: "ok" },
          },
        ],
      } as never,
    ];
    const out = repairTranscript(msgs);
    expect(out[1]).toBe(msgs[1]);
  });

  test("strips empty assistant shells", () => {
    const msgs: Message[] = [
      user("hi"),
      { id: "a1", role: "assistant", parts: [] } as never,
    ];
    expect(repairTranscript(msgs)).toHaveLength(1);
  });

  test("converts unresolved tool calls to interrupted error results", () => {
    for (const state of ["input-streaming", "input-available"]) {
      const msgs: Message[] = [
        user("hi"),
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "tool-Bash", toolCallId: "t1", state, input: { command: "ls" } },
          ],
        } as never,
      ];
      const out = repairTranscript(msgs);
      const part = (out[1] as Message).parts[0] as never as {
        state: string;
        errorText: string;
      };
      expect(part.state).toBe("output-error");
      expect(part.errorText).toContain("interrupted");
      expect((out[1] as Message).metadata?.isInterrupted).toBe(true);
    }
  });

  test("repairs dynamic-tool parts too", () => {
    const msgs: Message[] = [
      user("hi"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "Custom",
            toolCallId: "t1",
            state: "input-available",
            input: {},
          },
        ],
      } as never,
    ];
    const part = (repairTranscript(msgs)[1] as Message).parts[0] as never as {
      state: string;
    };
    expect(part.state).toBe("output-error");
  });
});
