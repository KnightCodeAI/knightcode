import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { query } from "./query";
import type { EngineEvent, Terminal, ToolOutcome } from "./events";
import type { Message } from "./messages";

// Drives the generator to completion, collecting events + terminal.
async function drain(
  gen: AsyncGenerator<EngineEvent, Terminal>,
): Promise<{ events: EngineEvent[]; terminal: Terminal }> {
  const events: EngineEvent[] = [];
  while (true) {
    const r = await gen.next();
    if (r.done) return { events, terminal: r.value };
    events.push(r.value);
  }
}

const userMsg = (text: string): Message =>
  ({
    id: "u1",
    role: "user",
    parts: [{ type: "text", text }],
    metadata: { submittedAt: Date.now() },
  }) as Message;

// The installed @ai-sdk/provider v3 spec uses nested usage on the raw stream
// ({ inputTokens: { total, ... }, outputTokens: { total, ... } }); streamText
// converts it to the public flat LanguageModelUsage with totalTokens.
const v3Finish = (
  unified: "stop" | "tool-calls",
): { unified: "stop" | "tool-calls"; raw: undefined } => ({
  unified,
  raw: undefined,
});

const v3Usage = (input: number, output: number) => ({
  inputTokens: {
    total: input,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: output, text: undefined, reasoning: undefined },
});

function textOnlyModel(text: string) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: text },
        { type: "text-end", id: "1" },
        {
          type: "finish",
          finishReason: v3Finish("stop"),
          usage: v3Usage(10, 5),
        },
      ]),
    }),
  });
}

// First call: emits a Read tool call. Second call: plain text.
function toolThenTextModel() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call++;
      if (call === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "tc1",
              toolName: "Read",
              input: JSON.stringify({ file_path: "C:/x.txt" }),
            },
            {
              type: "finish",
              finishReason: v3Finish("tool-calls"),
              usage: v3Usage(10, 5),
            },
          ]),
        };
      }
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "file says hi" },
          { type: "text-end", id: "1" },
          {
            type: "finish",
            finishReason: v3Finish("stop"),
            usage: v3Usage(20, 5),
          },
        ]),
      };
    },
  });
}

const baseParams = (model: unknown, runTool?: (tc: never) => Promise<ToolOutcome>) => ({
  sessionId: "s1",
  cwd: process.cwd(),
  messages: [userMsg("hello")],
  mode: "BUILD" as const,
  modelId: "test-model",
  reasoningEffort: "medium" as const,
  runTool: runTool ?? (async () => ({ kind: "output", output: {} }) as const),
  // Injected for tests — bypasses resolveModel/OpenRouter.
  modelOverrideForTest: model,
});

describe("query", () => {
  test("text-only turn: yields message updates and completes", async () => {
    const { events, terminal } = await drain(
      query(baseParams(textOnlyModel("hi there")) as never),
    );
    expect(terminal.reason).toBe("complete");
    const done = events.find((e) => e.type === "turn_complete");
    expect(done).toBeDefined();
    const msg = (done as { message: Message }).message;
    expect(msg.parts.some((p) => (p as { type: string }).type === "text")).toBe(true);
    expect(msg.metadata?.usage?.totalTokens).toBe(15);
    expect(typeof msg.metadata?.durationMs).toBe("number");
  });

  test("tool round: runs tool, loops, completes; tool part resolved", async () => {
    const calls: string[] = [];
    const runTool = async (tc: { toolName: string }): Promise<ToolOutcome> => {
      calls.push(tc.toolName);
      return { kind: "output", output: { content: "hi" } };
    };
    const { events, terminal } = await drain(
      query(baseParams(toolThenTextModel(), runTool as never) as never),
    );
    expect(terminal.reason).toBe("complete");
    expect(calls).toEqual(["Read"]);
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    const toolPart = done.message.parts.find((p) =>
      (p as { type: string }).type.startsWith("tool-"),
    ) as never as { state: string };
    expect(toolPart.state).toBe("output-available");
    // usage accumulated across both rounds
    expect(done.message.metadata?.usage?.totalTokens).toBe(40);
  });

  test("runTool error becomes output-error part; loop still continues", async () => {
    const runTool = async (): Promise<ToolOutcome> => ({
      kind: "error",
      errorText: "boom",
    });
    const { events, terminal } = await drain(
      query(baseParams(toolThenTextModel(), runTool as never) as never),
    );
    expect(terminal.reason).toBe("complete");
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    const toolPart = done.message.parts.find((p) =>
      (p as { type: string }).type.startsWith("tool-"),
    ) as never as { state: string; errorText: string };
    expect(toolPart.state).toBe("output-error");
    expect(toolPart.errorText).toBe("boom");
  });

  test("abort before tool execution yields interrupted turn", async () => {
    const ac = new AbortController();
    const runTool = async (): Promise<ToolOutcome> => {
      throw new Error("should not run");
    };
    // Abort as soon as the tool_call event is seen.
    const gen = query({
      ...(baseParams(toolThenTextModel(), runTool as never) as never as object),
      abortSignal: ac.signal,
    } as never);
    const events: EngineEvent[] = [];
    let terminal: Terminal | undefined;
    while (true) {
      const r = await gen.next();
      if (r.done) {
        terminal = r.value;
        break;
      }
      events.push(r.value);
      if (r.value.type === "tool_call") ac.abort();
    }
    expect(terminal?.reason).toBe("aborted");
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    expect(done.message.metadata?.isInterrupted).toBe(true);
    const toolPart = done.message.parts.find((p) =>
      (p as { type: string }).type.startsWith("tool-"),
    ) as never as { state: string };
    expect(toolPart.state).toBe("output-error");
  });
});
