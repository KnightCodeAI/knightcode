import { describe, expect, test } from "bun:test";
import type { ModeType } from "@repo/shared";
import type {
  PermissionDecision,
  ToolCallRequest,
  ToolHost,
} from "./events";
import { NOOP_ENGINE_HOOKS, type EngineHooks } from "./hooks";
import { ToolLoopGuard, LOOP_PROTECTION_ERROR } from "./tool-runner";
import {
  partitionToolCalls,
  runToolCalls,
  type SchedulerEvent,
} from "./scheduler";

const tc = (toolName: string, input: unknown, id = toolName): ToolCallRequest => ({
  toolCallId: id,
  toolName,
  input,
});

const makeHost = (overrides: Partial<ToolHost> = {}): ToolHost => ({
  executeTool: async () => ({ ok: true }),
  canUseTool: async () => ({ behavior: "allow" }),
  askQuestion: async () => ({ answers: [] }),
  isCommandAllowed: () => false,
  onAlwaysAllowBash: () => {},
  ...overrides,
});

type RunOpts = {
  mode?: ModeType;
  hooks?: EngineHooks;
  abortSignal?: AbortSignal;
  alwaysAllowEdits?: { get: () => boolean; set: (v: boolean) => void };
  onEvent?: (e: SchedulerEvent) => void;
};

async function run(
  toolCalls: ToolCallRequest[],
  host: ToolHost,
  opts: RunOpts = {},
): Promise<{ events: SchedulerEvent[]; reminders: string[] }> {
  let allow = false;
  const gen = runToolCalls({
    toolCalls,
    host,
    hooks: opts.hooks ?? NOOP_ENGINE_HOOKS,
    getMode: () => opts.mode ?? "BUILD",
    loopGuard: new ToolLoopGuard(),
    alwaysAllowEdits:
      opts.alwaysAllowEdits ?? { get: () => allow, set: (v) => (allow = v) },
    abortSignal: opts.abortSignal,
  });
  const events: SchedulerEvent[] = [];
  while (true) {
    const r = await gen.next();
    if (r.done) return { events, reminders: r.value };
    events.push(r.value);
    opts.onEvent?.(r.value);
  }
}

const resultOf = (events: SchedulerEvent[], id: string) =>
  events.find((e) => e.type === "tool_result" && e.toolCallId === id) as Extract<
    SchedulerEvent,
    { type: "tool_result" }
  >;

describe("partitionToolCalls", () => {
  test("groups contiguous safe calls; unsafe are singleton batches", () => {
    const batches = partitionToolCalls([
      tc("Read", { file_path: "a" }, "r1"),
      tc("Grep", { pattern: "x" }, "g1"),
      tc("Bash", { command: "ls" }, "b1"),
      tc("Read", { file_path: "b" }, "r2"),
    ]);
    expect(batches.map((b) => ({ safe: b.safe, ids: b.calls.map((c) => c.toolCallId) }))).toEqual([
      { safe: true, ids: ["r1", "g1"] },
      { safe: false, ids: ["b1"] },
      { safe: true, ids: ["r2"] },
    ]);
  });

  test("unknown tools are treated as unsafe", () => {
    const batches = partitionToolCalls([tc("Nope", {}, "n1")]);
    expect(batches[0]!.safe).toBe(false);
  });
});

describe("runToolCalls", () => {
  test("safe batch runs concurrently: all start before any finishes", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const host = makeHost({
      executeTool: async (call) => {
        started.push(call.toolCallId);
        if (started.length === 3) release();
        await gate; // every call blocks until all three have started
        return { ok: call.toolCallId };
      },
    });
    const { events } = await run(
      [
        tc("Read", { file_path: "a" }, "r1"),
        tc("Read", { file_path: "b" }, "r2"),
        tc("Read", { file_path: "c" }, "r3"),
      ],
      host,
    );
    expect(started.sort()).toEqual(["r1", "r2", "r3"]);
    expect(events.filter((e) => e.type === "tool_result")).toHaveLength(3);
  });

  test("unsafe calls serialize: second starts only after first resolves", async () => {
    const order: string[] = [];
    const host = makeHost({
      executeTool: async (call) => {
        order.push(`start:${call.toolCallId}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${call.toolCallId}`);
        return {};
      },
      isCommandAllowed: () => true,
    });
    await run(
      [tc("Bash", { command: "a" }, "b1"), tc("Bash", { command: "b" }, "b2")],
      host,
    );
    expect(order).toEqual(["start:b1", "end:b1", "start:b2", "end:b2"]);
  });

  test("denial becomes an error tool_result with the user's guidance", async () => {
    const host = makeHost({
      canUseTool: async (): Promise<PermissionDecision> => ({
        behavior: "deny",
        feedback: "use the other file",
      }),
      executeTool: async () => {
        throw new Error("must not execute");
      },
    });
    const { events } = await run(
      [tc("Write", { file_path: "x", content: "y" }, "w1")],
      host,
    );
    const r = resultOf(events, "w1");
    expect(r.outcome.kind).toBe("error");
    expect((r.outcome as { errorText: string }).errorText).toContain(
      "use the other file",
    );
  });

  test("AUTO mode executes gated tools without consulting canUseTool", async () => {
    let asked = 0;
    const host = makeHost({
      canUseTool: async () => {
        asked++;
        return { behavior: "allow" };
      },
    });
    const { events } = await run(
      [tc("Write", { file_path: "x", content: "y" }, "w1")],
      host,
      { mode: "AUTO" },
    );
    expect(asked).toBe(0);
    expect(resultOf(events, "w1").outcome.kind).toBe("output");
  });

  test("AskUserQuestion resolves through askQuestion, even in AUTO", async () => {
    const host = makeHost({
      askQuestion: async () => ({ answers: [{ question: "q", answer: "a" }] }),
    });
    const { events } = await run(
      [
        tc(
          "AskUserQuestion",
          {
            questions: [
              {
                question: "Which one?",
                options: [{ label: "a" }, { label: "b" }],
              },
            ],
          },
          "q1",
        ),
      ],
      host,
      { mode: "AUTO" },
    );
    const r = resultOf(events, "q1");
    expect(r.outcome.kind).toBe("output");
    expect((r.outcome as { output: { answers: unknown[] } }).output.answers)
      .toHaveLength(1);
  });

  test("always-allow grant persists: bash → onAlwaysAllowBash, edit → flag", async () => {
    const allowed: string[] = [];
    let editsAllowed = false;
    const host = makeHost({
      canUseTool: async () => ({ behavior: "allow", always: true }),
      onAlwaysAllowBash: (cmd) => allowed.push(cmd),
    });
    await run(
      [
        tc("Bash", { command: "bun test" }, "b1"),
        tc("Edit", { file_path: "f", old_string: "a", new_string: "b" }, "e1"),
      ],
      host,
      {
        alwaysAllowEdits: {
          get: () => editsAllowed,
          set: (v) => (editsAllowed = v),
        },
      },
    );
    expect(allowed).toEqual(["bun test"]);
    expect(editsAllowed).toBe(true);
  });

  test("alwaysAllowEdits=true skips the prompt for later edits", async () => {
    let asked = 0;
    const host = makeHost({
      canUseTool: async () => {
        asked++;
        return { behavior: "allow", always: true };
      },
    });
    await run(
      [
        tc("Edit", { file_path: "f", old_string: "a", new_string: "b" }, "e1"),
        tc("Edit", { file_path: "g", old_string: "a", new_string: "b" }, "e2"),
      ],
      host,
    );
    expect(asked).toBe(1); // second edit auto-approved by the engine flag
  });

  test("loop guard rejects an identical call repeated across rounds", async () => {
    // Within a round, identical safe calls are deduped to one execution (see the
    // dedup tests below), so the loop guard's real job is cross-round repeats: a
    // shared guard threads through successive rounds and rejects the 4th.
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return {};
      },
    });
    const loopGuard = new ToolLoopGuard();
    const oneRound = async (id: string): Promise<SchedulerEvent[]> => {
      const gen = runToolCalls({
        toolCalls: [tc("Grep", { pattern: "x" }, id)],
        host,
        hooks: NOOP_ENGINE_HOOKS,
        getMode: () => "BUILD",
        loopGuard,
        alwaysAllowEdits: { get: () => false, set: () => {} },
      });
      const events: SchedulerEvent[] = [];
      while (true) {
        const r = await gen.next();
        if (r.done) break;
        events.push(r.value);
      }
      return events;
    };
    await oneRound("g1");
    await oneRound("g2");
    await oneRound("g3");
    const events = await oneRound("g4"); // 4th identical → rejected
    expect(executions).toBe(3);
    const last = resultOf(events, "g4");
    expect(last.outcome.kind).toBe("error");
    expect((last.outcome as { errorText: string }).errorText).toBe(
      LOOP_PROTECTION_ERROR,
    );
  });

  test("central zod parse: invalid input never reaches the executor", async () => {
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return {};
      },
    });
    // Grep requires `pattern` — {} fails schema parse.
    const { events } = await run([tc("Grep", {}, "g1")], host);
    expect(executions).toBe(0);
    const r = resultOf(events, "g1");
    expect(r.outcome.kind).toBe("error");
    expect((r.outcome as { errorText: string }).errorText).toContain(
      "Invalid input",
    );
  });

  test("PreToolUse block → error result, no prompt, no execution; systemMessages collected", async () => {
    let executions = 0;
    let asked = 0;
    const hooks: EngineHooks = {
      preToolUse: async (toolName) =>
        toolName === "Write"
          ? { blocked: true, reason: "protected path", systemMessage: "pre says hi" }
          : { blocked: false },
      postToolUse: async () => ({ systemMessage: "post says hi" }),
      postToolUseFailure: async () => {},
    };
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return {};
      },
      canUseTool: async () => {
        asked++;
        return { behavior: "allow" };
      },
    });
    const { events, reminders } = await run(
      [
        tc("Write", { file_path: "x", content: "y" }, "w1"),
        tc("Read", { file_path: "a" }, "r1"),
      ],
      host,
      { hooks },
    );
    const blocked = resultOf(events, "w1");
    expect(blocked.outcome.kind).toBe("error");
    expect((blocked.outcome as { errorText: string }).errorText).toContain(
      "protected path",
    );
    expect(asked).toBe(0); // block decided before the permission prompt
    expect(executions).toBe(1); // only Read ran
    expect(reminders).toContain("pre says hi");
    expect(reminders).toContain("post says hi");
  });

  test("executor throw → error result + postToolUseFailure hook", async () => {
    const failures: string[] = [];
    const hooks: EngineHooks = {
      preToolUse: async () => ({ blocked: false }),
      postToolUse: async () => ({}),
      postToolUseFailure: async (_t, _i, error) => {
        failures.push(error);
      },
    };
    const host = makeHost({
      executeTool: async () => {
        throw new Error("disk on fire");
      },
    });
    const { events } = await run([tc("Read", { file_path: "a" }, "r1")], host, {
      hooks,
    });
    const r = resultOf(events, "r1");
    expect(r.outcome.kind).toBe("error");
    expect(failures).toEqual(["disk on fire"]);
  });

  test("canUseTool throwing becomes an error result; the round keeps going", async () => {
    const host = makeHost({
      canUseTool: async () => {
        throw new Error("prompt UI exploded");
      },
    });
    const { events } = await run(
      [
        tc("Write", { file_path: "x", content: "y" }, "w1"),
        tc("Read", { file_path: "a" }, "r1"),
      ],
      host,
    );
    const w = resultOf(events, "w1");
    expect(w.outcome.kind).toBe("error");
    expect((w.outcome as { errorText: string }).errorText).toContain(
      "prompt UI exploded",
    );
    // The throw must not abort the round — the next call still runs and pairs.
    expect(resultOf(events, "r1").outcome.kind).toBe("output");
  });

  test("askQuestion throwing becomes an error result, not an orphaned tool_use", async () => {
    const host = makeHost({
      askQuestion: async () => {
        throw new Error("question prompt closed");
      },
    });
    const { events } = await run(
      [
        tc(
          "AskUserQuestion",
          {
            questions: [
              { question: "q", options: [{ label: "a" }, { label: "b" }] },
            ],
          },
          "q1",
        ),
      ],
      host,
    );
    const r = resultOf(events, "q1");
    expect(r).toBeDefined(); // tool_result emitted despite the throw
    expect(r.outcome.kind).toBe("error");
    expect((r.outcome as { errorText: string }).errorText).toContain(
      "question prompt closed",
    );
  });

  test("abort before a serial call starts: no further tool_start events", async () => {
    const ac = new AbortController();
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return {};
      },
      isCommandAllowed: () => true,
    });
    const { events } = await run(
      [tc("Bash", { command: "a" }, "b1"), tc("Bash", { command: "b" }, "b2")],
      host,
      {
        onEvent: (e) => {
          if (e.type === "tool_result" && e.toolCallId === "b1") ac.abort();
        },
        abortSignal: ac.signal,
      },
    );
    expect(executions).toBe(1);
    expect(
      events.some((e) => e.type === "tool_start" && e.toolCall.toolCallId === "b2"),
    ).toBe(false);
  });

  test("modelOverride from the permission decision reaches executeTool", async () => {
    let seen: string | undefined;
    const host = makeHost({
      canUseTool: async () => ({
        behavior: "allow",
        modelOverride: "openai/gpt-5",
      }),
      executeTool: async (_call, _mode, opts) => {
        seen = opts.modelOverride;
        return {};
      },
    });
    await run([tc("Agent", { description: "d", prompt: "p" }, "a1")], host);
    expect(seen).toBe("openai/gpt-5");
  });

  test("dedupes identical safe calls in a round: one execution, fanned results", async () => {
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return { ok: true };
      },
      isCommandAllowed: () => true,
    });
    // Two identical Grep calls (concurrency-safe) with distinct ids.
    const { events } = await run(
      [tc("Grep", { pattern: "x" }, "g1"), tc("Grep", { pattern: "x" }, "g2")],
      host,
    );
    // Executed once, but both ids got a result.
    expect(executions).toBe(1);
    const resultIds = events
      .filter((e) => e.type === "tool_result")
      .map((e) => (e as { toolCallId: string }).toolCallId)
      .sort();
    expect(resultIds).toEqual(["g1", "g2"]);
  });

  test("identical concurrency-safe but NON-read-only calls (Agent) are NOT deduped", async () => {
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return { ok: true };
      },
    });
    // Two byte-identical Agent calls: Agent is concurrency-safe (so they batch
    // together) but NOT read-only, so each must spawn its own subagent.
    const { events } = await run(
      [
        tc("Agent", { description: "d", prompt: "p" }, "a1"),
        tc("Agent", { description: "d", prompt: "p" }, "a2"),
      ],
      host,
    );
    expect(executions).toBe(2);
    const resultIds = events
      .filter((e) => e.type === "tool_result")
      .map((e) => (e as { toolCallId: string }).toolCallId)
      .sort();
    expect(resultIds).toEqual(["a1", "a2"]);
  });

  test("distinct safe inputs are NOT deduped", async () => {
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return { ok: true };
      },
    });
    await run(
      [tc("Grep", { pattern: "x" }, "g1"), tc("Grep", { pattern: "y" }, "g2")],
      host,
    );
    expect(executions).toBe(2);
  });
});
