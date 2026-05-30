import { describe, expect, test, mock } from "bun:test";
import { runSubagentLoop } from "./run-subagent";

describe("runSubagentLoop", () => {
  test("executes tool calls then returns final text", async () => {
    const step = mock(async ({ messages }: { messages: any[] }) => {
      const calledTool = messages.some((m) => m.role === "tool");
      return calledTool
        ? { text: "done: found 3 files", toolCalls: [], finishReason: "stop", usage: null }
        : {
            text: "",
            toolCalls: [{ toolCallId: "t1", toolName: "Glob", input: { pattern: "**/*.ts" } }],
            finishReason: "tool-calls",
            usage: null,
          };
    });
    const exec = mock(async () => ({ matches: ["a.ts", "b.ts", "c.ts"] }));

    const result = await runSubagentLoop({
      system: "you are a search agent",
      prompt: "find ts files",
      toolNames: ["Glob"],
      mode: "BUILD",
      model: "claude-haiku-4-5-20251001",
      maxTurns: 5,
      callStep: step as any,
      executeTool: exec as any,
      requestPermission: async () => true,
      needsPermission: () => false,
    });

    expect(result.text).toBe("done: found 3 files");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledTimes(2);
  });

  test("stops at maxTurns", async () => {
    const step = mock(async () => ({
      text: "",
      toolCalls: [{ toolCallId: "t", toolName: "Glob", input: {} }],
      finishReason: "tool-calls",
      usage: null,
    }));
    const result = await runSubagentLoop({
      system: "s",
      prompt: "p",
      toolNames: ["Glob"],
      mode: "BUILD",
      model: "claude-haiku-4-5-20251001",
      maxTurns: 2,
      callStep: step as any,
      executeTool: mock(async () => ({})) as any,
      requestPermission: async () => true,
      needsPermission: () => false,
    });
    expect(step).toHaveBeenCalledTimes(2);
    expect(result.stoppedReason).toBe("max_turns");
  });

  test("denied permission yields an error result, no execution", async () => {
    let turn = 0;
    const step = mock(async () => {
      turn++;
      return turn === 1
        ? {
            text: "",
            toolCalls: [{ toolCallId: "w1", toolName: "Write", input: { file_path: "x" } }],
            finishReason: "tool-calls",
            usage: null,
          }
        : { text: "could not write", toolCalls: [], finishReason: "stop", usage: null };
    });
    const exec = mock(async () => ({ ok: true }));

    const result = await runSubagentLoop({
      system: "s",
      prompt: "p",
      toolNames: ["Write"],
      mode: "BUILD",
      model: "claude-haiku-4-5-20251001",
      maxTurns: 5,
      callStep: step as any,
      executeTool: exec as any,
      requestPermission: async () => false,
      needsPermission: () => true,
    });

    expect(exec).toHaveBeenCalledTimes(0);
    expect(result.text).toBe("could not write");
  });
});
