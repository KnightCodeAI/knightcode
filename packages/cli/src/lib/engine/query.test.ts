import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { query } from "./query";
import type { EngineEvent, Terminal, ToolHost } from "./events";
import { NOOP_ENGINE_HOOKS } from "./hooks";
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

// A text-only turn whose provider reports an OpenRouter usage-accounting cost
// on the finish part (the streaming path surfaces it on the fullStream
// finish-step's providerMetadata).
function textModelWithCost(cost: number) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: "hi" },
        { type: "text-end", id: "1" },
        {
          type: "finish",
          finishReason: v3Finish("stop"),
          usage: v3Usage(10, 5),
          providerMetadata: { openrouter: { usage: { cost } } },
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

const makeHost = (
  executeTool?: ToolHost["executeTool"],
  overrides: Partial<ToolHost> = {},
): ToolHost => ({
  executeTool: executeTool ?? (async () => ({})),
  canUseTool: async () => ({ behavior: "allow" }),
  askQuestion: async () => ({ answers: [] }),
  isCommandAllowed: () => true,
  onAlwaysAllowBash: () => {},
  ...overrides,
});

const baseParams = (model: unknown, host?: ToolHost) => ({
  cwd: process.cwd(),
  messages: [userMsg("hello")],
  mode: "BUILD" as const,
  modelId: "test-model",
  reasoningEffort: "medium" as const,
  host: host ?? makeHost(),
  hooks: NOOP_ENGINE_HOOKS,
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

  test("seals OpenRouter's reported cost onto the turn metadata", async () => {
    const { events } = await drain(
      query(baseParams(textModelWithCost(0.0042)) as never),
    );
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    expect(done.message.metadata?.costUsd).toBe(0.0042);
  });

  test("seals a reported cost of 0 (free turn) so it isn't re-priced from the table", async () => {
    const { events } = await drain(
      query(baseParams(textModelWithCost(0)) as never),
    );
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    // A reported 0 is authoritative — it must be present (not undefined), so the
    // UI doesn't fall back to price-table estimation for a genuinely free turn.
    expect(done.message.metadata?.costUsd).toBe(0);
  });

  test("omits costUsd entirely when no cost is reported", async () => {
    const { events } = await drain(
      query(baseParams(textOnlyModel("hi")) as never),
    );
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    expect(done.message.metadata?.costUsd).toBeUndefined();
  });

  test("tool round: runs tool, loops, completes; tool part resolved", async () => {
    const calls: string[] = [];
    const host = makeHost(async (tc) => {
      calls.push(tc.toolName);
      return { content: "hi" };
    });
    const { events, terminal } = await drain(
      query(baseParams(toolThenTextModel(), host) as never),
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

  test("executeTool throw becomes output-error part; loop still continues", async () => {
    const host = makeHost(async () => {
      throw new Error("boom");
    });
    const { events, terminal } = await drain(
      query(baseParams(toolThenTextModel(), host) as never),
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

  test("abort mid-stream (graceful abort part) yields interrupted turn", async () => {
    // The installed AI SDK never accepts a raw `abort` model-stream part
    // (runToolsTransformation throws "Unhandled chunk type"); streamText
    // synthesizes the fullStream `{ type: "abort" }` part itself when its
    // abortSignal fires mid-pull. So trigger the graceful abort path by
    // aborting on the first streamed text delta.
    const ac = new AbortController();
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "partial answer" },
          { type: "text-delta", id: "1", delta: " more text" },
          { type: "text-end", id: "1" },
          {
            type: "finish",
            finishReason: v3Finish("stop"),
            usage: v3Usage(10, 5),
          },
        ] as never),
      }),
    });
    const gen = query({
      ...(baseParams(model) as never as object),
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
      if (r.value.type === "message_update") ac.abort();
    }
    expect(terminal?.reason).toBe("aborted");
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    expect(done.message.metadata?.isInterrupted).toBe(true);
    expect(
      done.message.parts.some(
        (p) => (p as { type: string; text?: string }).type === "text",
      ),
    ).toBe(true);
  });

  test("malformed historical tool input does not poison the session", async () => {
    // Regression: a model once emitted Grep with input {} (missing required
    // `pattern`). The executor rejected it, but strict schema re-validation of
    // HISTORY threw on every later round, permanently erroring the session.
    const poisoned: Message[] = [
      userMsg("find usages"),
      {
        id: "a-old",
        role: "assistant",
        parts: [
          {
            type: "tool-Grep",
            toolCallId: "bad1",
            state: "output-error",
            input: {},
            errorText: "pattern: Invalid input: expected string",
          },
          { type: "text", text: "that failed" },
        ],
      } as never,
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "try again" }],
        metadata: { submittedAt: Date.now() },
      } as never,
    ];
    const params = {
      ...(baseParams(textOnlyModel("recovered fine")) as never as object),
      messages: poisoned,
    };
    const { events, terminal } = await drain(query(params as never));
    expect(terminal.reason).toBe("complete");
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    expect(done.message.metadata?.isInterrupted).toBeUndefined();
  });

  test("invalid (unparsable) tool call is not executed; resolves as error", async () => {
    let call = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        call++;
        if (call === 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tc-bad",
                toolName: "Read",
                input: "{not valid json",
              },
              {
                type: "finish",
                finishReason: v3Finish("tool-calls"),
                usage: v3Usage(10, 5),
              },
            ] as never),
          };
        }
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "self-corrected" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: v3Finish("stop"),
              usage: v3Usage(20, 5),
            },
          ] as never),
        };
      },
    });
    const calls: string[] = [];
    const host = makeHost(async (tc) => {
      calls.push(tc.toolName);
      return {};
    });
    const { events, terminal } = await drain(
      query(baseParams(model, host) as never),
    );
    expect(terminal.reason).toBe("complete");
    expect(calls).toEqual([]); // invalid call must never reach the executor
    const done = events.find((e) => e.type === "turn_complete") as {
      message: Message;
    };
    const toolPart = done.message.parts.find((p) =>
      (p as { type: string }).type.startsWith("tool-"),
    ) as never as { state: string; errorText?: string };
    expect(toolPart.state).toBe("output-error");
  });

  test("abort before tool execution yields interrupted turn", async () => {
    const ac = new AbortController();
    const host = makeHost(async () => {
      throw new Error("should not run");
    });
    // Abort as soon as the tool_call event is seen.
    const gen = query({
      ...(baseParams(toolThenTextModel(), host) as never as object),
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

  test("modeTransition output updates engine mode and emits mode_change", async () => {
    // Round 1 calls ExitPlanMode (unsafe, serialized); round 2 is text.
    let call = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        call++;
        if (call === 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tc1",
                toolName: "ExitPlanMode",
                input: JSON.stringify({ plan: "do it" }),
              },
              {
                type: "finish",
                finishReason: v3Finish("tool-calls"),
                usage: v3Usage(1, 1),
              },
            ] as never),
          };
        }
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "switching" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: v3Finish("stop"),
              usage: v3Usage(1, 1),
            },
          ] as never),
        };
      },
    });
    const host = makeHost(async () => ({ modeTransition: "BUILD" }));
    // ExitPlanMode is deferred — seed a prior ToolSearch load so the engine
    // includes its contract (otherwise streamText flags the call invalid).
    const toolSearchLoad: Message = {
      id: "a-toolsearch",
      role: "assistant",
      parts: [
        {
          type: "tool-ToolSearch",
          toolCallId: "ts1",
          state: "output-available",
          input: { query: "select:ExitPlanMode" },
          output: { matches: [{ name: "ExitPlanMode" }] },
        },
      ],
    } as never;
    const params = {
      ...baseParams(model, host),
      messages: [toolSearchLoad, userMsg("exit plan mode")],
      mode: "PLAN" as const,
    };
    const { events, terminal } = await drain(query(params as never));
    expect(terminal.reason).toBe("complete");
    const modeEvent = events.find((e) => e.type === "mode_change") as {
      mode: string;
    };
    expect(modeEvent).toBeDefined();
    expect(modeEvent.mode).toBe("BUILD");
  });

  test("hook systemMessages are injected into the next round's request", async () => {
    const prompts: string[] = [];
    let call = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        call++;
        prompts.push(JSON.stringify(options.prompt));
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
                usage: v3Usage(1, 1),
              },
            ] as never),
          };
        }
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "done" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: v3Finish("stop"),
              usage: v3Usage(1, 1),
            },
          ] as never),
        };
      },
    });
    const params = {
      ...baseParams(model),
      hooks: {
        preToolUse: async () => ({ blocked: false }),
        postToolUse: async () => ({ systemMessage: "lint passed on x.txt" }),
        postToolUseFailure: async () => {},
      },
    };
    const { terminal } = await drain(query(params as never));
    expect(terminal.reason).toBe("complete");
    expect(prompts[0]).not.toContain("lint passed on x.txt");
    expect(prompts[1]).toContain("lint passed on x.txt");
  });
});
