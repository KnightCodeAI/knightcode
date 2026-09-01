# Query Engine — Phase 0 (Harness Comparison) + Phase 1 (Engine Skeleton + Transcript Integrity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the full claude-code↔knightcode harness comparison doc, then replace the React-hosted agent loop (`useChat` + `LocalChatTransport`) with a standalone async-generator query engine that guarantees tool_use/tool_result pairing.

**Architecture:** New UI-free module `packages/cli/src/lib/engine/` — `query()` is an async generator yielding typed events and returning a terminal state. The engine assembles assistant UIMessage parts from the model stream itself and executes tools through an injected `runTool` callback. A new `useQueryEngine` hook (same public surface as today's `useChat`) drives the generator and owns permission prompts. `use-chat.ts` and `local-chat-transport.ts` are deleted.

**Tech Stack:** Bun, TypeScript, `ai` v6 core (`streamText`, `validateUIMessages`, `convertToModelMessages`), `ai/test` (`MockLanguageModelV3`, `convertArrayToReadableStream`), bun:test, Ink/React.

**Spec:** `docs/superpowers/specs/2026-06-10-query-engine-design.md` — read it first.

**Rules for this repo (from the user, non-negotiable):**
- Do NOT commit this plan, the spec, or `docs/harness-comparison.md`. Code commits only.
- Never add Claude attribution / `Co-Authored-By` trailers to commit messages.
- Work on branch `engine-phase-1`. The user opens PRs themselves.
- Run commands from the repo root unless stated. Test command: `bun test` (scoped: `bun test <path>`). Typecheck: `bun run check-types` (run in `packages/cli`).

**Spec deviations locked in this plan (intentional):**
1. Loop protection ships in Phase 1, not Phase 2 — deleting `use-chat.ts` would otherwise regress an existing behavior (`use-chat.ts:772-785`).
2. Engine yields `message_update` snapshots instead of raw text/reasoning delta events (spec already updated).

---

## Task 0: Phase 0 — Harness comparison document

**Files:**
- Create: `docs/harness-comparison.md` (do NOT commit)

- [ ] **Step 0.1: Read the claude-code harness sources.** Read each of these (skim where huge, but extract concrete mechanisms, not vibes):
  - `claude-code/src/query.ts` (the loop: State, continue-transitions, recovery, stop hooks)
  - `claude-code/src/QueryEngine.ts` (standalone engine wrapper / ask())
  - `claude-code/src/services/tools/toolOrchestration.ts` + `toolExecution.ts` + `toolHooks.ts` + `StreamingToolExecutor.ts`
  - `claude-code/src/Tool.ts` (tool contract surface: `isConcurrencySafe`, `maxResultSizeChars`, prompts, validation)
  - `claude-code/src/utils/conversationRecovery.ts` (repair/interrupt detection)
  - `claude-code/src/services/compact/` — `microCompact.ts`, `autoCompact.ts`, `compact.ts`, `grouping.ts`
  - `claude-code/src/utils/messages.ts:4500-4700` (compact boundary message model)
  - `claude-code/src/query/stopHooks.ts`, `claude-code/src/query/tokenBudget.ts`, `claude-code/src/query/transitions.ts`
  - `claude-code/src/utils/attachments.ts` (context injection per turn)
  - `claude-code/src/context/QueuedMessageContext.tsx` (message queueing while streaming)

- [ ] **Step 0.2: Read the knightcode counterparts** (most already analyzed in the spec): `packages/cli/src/hooks/use-chat.ts`, `packages/cli/src/lib/inference/local-chat-transport.ts`, `packages/cli/src/lib/tools/index.ts`, `packages/cli/src/lib/tools/Agent/{execute,run-subagent}.ts`, `packages/cli/src/lib/hooks.ts`, `packages/cli/src/lib/inference/compact-conversation.ts`.

- [ ] **Step 0.3: Write `docs/harness-comparison.md`** with this exact structure. For every row state: what claude-code does (with file:line refs), what knightcode does today (file:line refs), and a verdict tag: `ADOPT-P1` … `ADOPT-P6` (phase per the spec), `LATER` (post-Phase-6 backlog), or `SKIP` (with one-line reason).

  ```markdown
  # Claude-Code vs Knightcode: Harness Comparison
  ## 1. Loop architecture (generator engine vs UI-hosted useChat)
  ## 2. Message integrity & recovery (repair, interrupt detection, orphan filtering)
  ## 3. Tool orchestration (concurrency safety, scheduling, permission flow)
  ## 4. Hook system (events, blocking, systemMessage channels)
  ## 5. Context assembly (system prompt, attachments, caching, deferred tools)
  ## 6. Compaction stack (microcompact, autocompact, boundaries, snip)
  ## 7. Recovery paths (retries, fallback model, reactive compaction, token budgets)
  ## 8. Subagents (recursive query, streaming, parallelism, model resolution)
  ## 9. Truncation & result-size budgets
  ## 10. Queueing & turn lifecycle (queued messages, stop hooks, timing)
  ## 11. Tool/UI rendering (per-tool renderers, grouping, progress)
  ## 12. Out of scope in claude-code (voice, IDE, swarms, remote) — all SKIP
  ## Verdict summary table (one row per mechanism, tag column)
  ```

- [ ] **Step 0.4: Self-check the doc** — every mechanism in sections 1–11 has a verdict tag and at least one file:line reference per column. No "TBD". Do not commit.

---

## Task 1: Branch setup

- [ ] **Step 1.1:**

```bash
git checkout -b engine-phase-1
```

---

## Task 2: Move shared message types to `engine/messages.ts`

`Message`, `ChatMessageMetadata`, and `PendingConfirmation` currently live in `packages/cli/src/hooks/use-chat.ts` (lines 37–71) and are imported by UI components. They must survive the deletion of that file.

**Files:**
- Create: `packages/cli/src/lib/engine/messages.ts`
- Modify: `packages/cli/src/hooks/use-chat.ts` (re-export shim, keeps tree compiling until Task 8)
- Modify: every file importing these types from `../hooks/use-chat` (found via grep)

- [ ] **Step 2.1: Create `packages/cli/src/lib/engine/messages.ts`** — move the type definitions verbatim from `use-chat.ts:37-71` (imports adjusted):

```ts
import type {
  ModeType,
  ReasoningEffortLevel,
  SupportedChatModelId,
  ToolContracts,
} from "@repo/shared";
import type { InferUITools, LanguageModelUsage, UIMessage } from "ai";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  reasoningEffort?: ReasoningEffortLevel;
  /** Wall-clock ms when the user submitted this prompt; anchors turn timing. */
  submittedAt?: number;
  durationMs?: number;
  usage?: LanguageModelUsage;
  isCompaction?: boolean;
  isInterrupted?: boolean;
  originalMessageCount?: number;
  summaryCount?: number;
  preservedCount?: number;
  commandProgressMessage?: string;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export type PendingConfirmation = {
  toolCallId: string;
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: any;
  };
  mode: ModeType;
  modelOverride?: SupportedChatModelId;
};
```

- [ ] **Step 2.2: In `use-chat.ts`, delete those definitions and replace with re-exports** so nothing else breaks yet:

```ts
export type {
  ChatMessageMetadata,
  Message,
  PendingConfirmation,
} from "../lib/engine/messages";
```

(Keep the rest of `use-chat.ts` working — it still imports `Message` for its own use; adjust its internal references to the re-imported type.)

- [ ] **Step 2.3: Update all other importers** to import from the new location:

```bash
grep -rln 'from "../hooks/use-chat"\|from "../../hooks/use-chat"' packages/cli/src --include=*.ts --include=*.tsx
```

For each file that imports ONLY types (`Message`, `ChatMessageMetadata`, `PendingConfirmation`), point it at `lib/engine/messages` (fix the relative path depth per file). Files importing the `useChat` function itself (`screens/session.tsx`) are left alone until Task 9.

- [ ] **Step 2.4: Typecheck + test:**

```bash
cd packages/cli; bun run check-types; cd ../..; bun test packages/cli
```
Expected: clean.

- [ ] **Step 2.5: Commit:**

```bash
git add -A packages/cli
git commit -m "refactor(cli): move chat message types to lib/engine/messages"
```

---

## Task 3: `engine/events.ts` — event and params types

**Files:**
- Create: `packages/cli/src/lib/engine/events.ts`

- [ ] **Step 3.1: Create the file:**

```ts
import type { LanguageModelUsage } from "ai";
import type { ModeType, ReasoningEffortLevel } from "@repo/shared";
import type { Message } from "./messages";

export type ToolCallRequest = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type ToolOutcome =
  | { kind: "output"; output: unknown }
  | { kind: "error"; errorText: string };

export type EngineEvent =
  | { type: "stream_start" }
  /** In-progress assistant message snapshot; replaces the previous snapshot. */
  | { type: "message_update"; message: Message }
  | { type: "tool_call"; toolCall: ToolCallRequest }
  | { type: "tool_result"; toolCallId: string; outcome: ToolOutcome }
  /** Final assistant message for the turn, metadata (durationMs/usage) attached. */
  | { type: "turn_complete"; message: Message };

export type TerminalReason = "complete" | "aborted" | "max_rounds" | "error";
export type Terminal = { reason: TerminalReason; error?: unknown };

export type QueryParams = {
  sessionId: string;
  cwd: string;
  /** Full transcript including the just-submitted user message. */
  messages: Message[];
  mode: ModeType;
  modelId: string;
  reasoningEffort: ReasoningEffortLevel;
  getApiKey?: () => string | undefined;
  /** Executes one tool call (permission gating happens inside). Must not throw
   *  for ordinary failures — return { kind: "error" }. Throws are still caught. */
  runTool: (toolCall: ToolCallRequest) => Promise<ToolOutcome>;
  abortSignal?: AbortSignal;
  /** Anchor for durationMs (the user's submit time). Defaults to Date.now(). */
  turnStartMs?: number;
  /** Ms spent waiting on the user this turn — subtracted from durationMs. */
  getTurnPausedMs?: () => number;
  maxRounds?: number; // default 100
};
```

- [ ] **Step 3.2: Typecheck and commit:**

```bash
cd packages/cli; bun run check-types; cd ../..
git add packages/cli/src/lib/engine/events.ts
git commit -m "feat(cli): add engine event and params types"
```

---

## Task 4: `engine/transcript.ts` — repair pass (TDD)

**Files:**
- Create: `packages/cli/src/lib/engine/transcript.ts`
- Test: `packages/cli/src/lib/engine/transcript.test.ts`

- [ ] **Step 4.1: Write the failing tests:**

```ts
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
```

- [ ] **Step 4.2: Run to verify failure:**

```bash
bun test packages/cli/src/lib/engine/transcript.test.ts
```
Expected: FAIL — `Cannot find module './transcript'`.

- [ ] **Step 4.3: Implement `transcript.ts`:**

```ts
import type { Message } from "./messages";

const UNRESOLVED_STATES = new Set(["input-streaming", "input-available"]);

function isToolPart(part: unknown): part is {
  type: string;
  state?: string;
  toolCallId?: string;
} {
  if (!part || typeof part !== "object") return false;
  const type = (part as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    (type === "dynamic-tool" || type.startsWith("tool-"))
  );
}

export const INTERRUPTED_TOOL_ERROR =
  "Tool execution was interrupted before completing.";

/**
 * Guarantee transcript integrity before a request: strip empty assistant
 * shells and resolve any tool call that never received a result into an
 * output-error part, marking the message interrupted. Healthy messages are
 * returned by reference (cheap no-op for clean transcripts).
 */
export function repairTranscript(messages: Message[]): Message[] {
  return messages
    .filter((m) => !(m.role === "assistant" && m.parts.length === 0))
    .map((m) => {
      if (m.role !== "assistant") return m;
      let repaired = false;
      const parts = m.parts.map((part) => {
        if (isToolPart(part) && UNRESOLVED_STATES.has(part.state ?? "")) {
          repaired = true;
          return {
            ...(part as object),
            state: "output-error",
            errorText: INTERRUPTED_TOOL_ERROR,
          };
        }
        return part;
      });
      if (!repaired) return m;
      return {
        ...m,
        parts: parts as Message["parts"],
        metadata: { ...m.metadata, isInterrupted: true },
      };
    });
}
```

- [ ] **Step 4.4: Run tests:**

```bash
bun test packages/cli/src/lib/engine/transcript.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 4.5: Commit:**

```bash
git add packages/cli/src/lib/engine/transcript.ts packages/cli/src/lib/engine/transcript.test.ts
git commit -m "feat(cli): add transcript repair pass for unresolved tool calls"
```

---

## Task 5: `engine/query.ts` — the loop (TDD)

**Files:**
- Create: `packages/cli/src/lib/engine/query.ts`
- Test: `packages/cli/src/lib/engine/query.test.ts`

The engine consumes `result.fullStream` and assembles assistant UIMessage parts itself. **Caution:** verify the exact v6 `fullStream` part shapes against `node_modules/ai/dist/index.d.ts` while implementing — the tests below use `MockLanguageModelV3`, so any field-name mismatch (`delta` vs `text`) will surface as a test failure, fix against the real types.

- [ ] **Step 5.1: Write the failing tests:**

```ts
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
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
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
              finishReason: "tool-calls",
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
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
            finishReason: "stop",
            usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
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
```

- [ ] **Step 5.2: Run to verify failure:**

```bash
bun test packages/cli/src/lib/engine/query.test.ts
```
Expected: FAIL — `Cannot find module './query'`.

- [ ] **Step 5.3: Implement `query.ts`.** Note the test-only `modelOverrideForTest` hook — production resolves via `resolveModel`:

```ts
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import {
  getDeferredToolNames,
  getToolContracts,
  TASK_SUITE_TOOL_NAMES,
} from "@repo/shared";
import { buildRequestContext } from "../inference/build-request-context";
import { buildSystemPrompt } from "../inference/system-prompt";
import { extractLoadedDeferredTools } from "../inference/loaded-deferred-tools";
import { resolveModel } from "../inference/resolve-model";
import type {
  EngineEvent,
  QueryParams,
  Terminal,
  ToolCallRequest,
  ToolOutcome,
} from "./events";
import type { Message } from "./messages";
import { INTERRUPTED_TOOL_ERROR, repairTranscript } from "./transcript";

const DEFAULT_MAX_ROUNDS = 100;

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
};

function addUsage(
  acc: LanguageModelUsage | null,
  u: LanguageModelUsage | undefined,
): LanguageModelUsage | null {
  if (!u) return acc;
  if (!acc) return u;
  return {
    ...acc,
    inputTokens: (acc.inputTokens ?? 0) + (u.inputTokens ?? 0),
    outputTokens: (acc.outputTokens ?? 0) + (u.outputTokens ?? 0),
    totalTokens: (acc.totalTokens ?? 0) + (u.totalTokens ?? 0),
  };
}

function snapshot(message: Message): Message {
  return { ...message, parts: [...message.parts] };
}

/** Record ToolSearch matches so later rounds include the loaded schemas. */
function trackToolSearchLoads(
  toolCall: ToolCallRequest,
  outcome: ToolOutcome,
  loaded: Set<string>,
): void {
  if (toolCall.toolName !== "ToolSearch" || outcome.kind !== "output") return;
  const matches = (outcome.output as { matches?: unknown })?.matches;
  if (!Array.isArray(matches)) return;
  for (const m of matches) {
    const name = (m as { name?: unknown })?.name;
    if (typeof name === "string") loaded.add(name);
  }
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<EngineEvent, Terminal> {
  const { cwd, mode, modelId, reasoningEffort, runTool, abortSignal } = params;
  const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const turnStartMs = params.turnStartMs ?? Date.now();

  const transcript = repairTranscript(params.messages);
  const loadedDeferred = extractLoadedDeferredTools(transcript);

  const assistant: Message = {
    id: `asst-${crypto.randomUUID()}`,
    role: "assistant",
    parts: [],
    metadata: { mode, model: modelId },
  } as Message;
  let usage: LanguageModelUsage | null = null;

  // Stamps final metadata on the assistant message. Called exactly once.
  const sealTurn = (interrupted: boolean): Message => {
    const pausedMs = params.getTurnPausedMs?.() ?? 0;
    assistant.metadata = {
      ...assistant.metadata,
      durationMs: Math.max(
        0,
        Date.now() - turnStartMs - (Number.isFinite(pausedMs) ? pausedMs : 0),
      ),
      ...(usage ? { usage } : {}),
      ...(interrupted ? { isInterrupted: true } : {}),
    };
    // Resolve any tool parts that never got a result (abort/error paths).
    assistant.parts = assistant.parts.map((part) => {
      const p = part as never as ToolPart;
      if (
        typeof p?.type === "string" &&
        (p.type.startsWith("tool-") || p.type === "dynamic-tool") &&
        (p.state === "input-available" || p.state === "input-streaming")
      ) {
        return {
          ...p,
          state: "output-error",
          errorText: INTERRUPTED_TOOL_ERROR,
        } as never;
      }
      return part;
    }) as Message["parts"];
    return snapshot(assistant);
  };

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }

      const ctx = buildRequestContext(cwd);
      if (ctx.hasPersistedTasks) {
        for (const name of TASK_SUITE_TOOL_NAMES) loadedDeferred.add(name);
      }
      const tools = getToolContracts(mode, {
        loaded_deferred: loadedDeferred,
      }) as ToolSet;
      const availableDeferredTools = getDeferredToolNames(mode).filter(
        (name) => !loadedDeferred.has(name),
      );

      // Test seam: a raw LanguageModel injected by unit tests.
      const testModel = (params as { modelOverrideForTest?: unknown })
        .modelOverrideForTest;
      const resolved = testModel
        ? { model: testModel as never, providerOptions: undefined }
        : resolveModel(modelId, reasoningEffort, { getApiKey: params.getApiKey });

      const requestMessages =
        assistant.parts.length > 0 ? [...transcript, assistant] : transcript;
      const validated = await validateUIMessages({
        messages: requestMessages,
        tools: tools as never,
      });
      const modelMessages = await convertToModelMessages(validated, {
        tools: tools as never,
      });

      yield { type: "stream_start" };

      const result = streamText({
        model: resolved.model,
        system: buildSystemPrompt({
          mode,
          globalInstructions: ctx.globalInstructions,
          projectInstructions: ctx.projectInstructions,
          localInstructions: ctx.localInstructions,
          rules: ctx.rules,
          skillIndex: ctx.skillIndex,
          gitBranchName: ctx.gitBranchName,
          gitStatus: ctx.gitStatus,
          gitDiffSummary: ctx.gitDiffSummary,
          frameworks: ctx.frameworks,
          packageManager: ctx.packageManager,
          isTypeScript: ctx.isTypeScript,
          shellName: ctx.shellName,
          platform: ctx.platform,
          availableDeferredTools,
          agentTypes: ctx.agentTypes,
        }),
        messages: modelMessages,
        tools,
        providerOptions: resolved.providerOptions,
        abortSignal,
      });

      // Assemble assistant parts from the raw stream.
      const toolCalls: ToolCallRequest[] = [];
      let activeText: { type: "text"; text: string } | null = null;
      let activeReasoning: { type: "reasoning"; text: string } | null = null;

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-start":
            activeText = { type: "text", text: "" };
            assistant.parts.push(activeText as never);
            break;
          case "text-delta":
            if (activeText) {
              activeText.text += part.text;
              yield { type: "message_update", message: snapshot(assistant) };
            }
            break;
          case "text-end":
            activeText = null;
            break;
          case "reasoning-start":
            activeReasoning = { type: "reasoning", text: "" };
            assistant.parts.push(activeReasoning as never);
            break;
          case "reasoning-delta":
            if (activeReasoning) {
              activeReasoning.text += part.text;
              yield { type: "message_update", message: snapshot(assistant) };
            }
            break;
          case "reasoning-end":
            activeReasoning = null;
            break;
          case "tool-call": {
            const toolCall: ToolCallRequest = {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            };
            toolCalls.push(toolCall);
            assistant.parts.push({
              type: `tool-${part.toolName}`,
              toolCallId: part.toolCallId,
              state: "input-available",
              input: part.input,
            } as never);
            yield { type: "message_update", message: snapshot(assistant) };
            break;
          }
          case "finish":
            usage = addUsage(usage, part.totalUsage);
            break;
          case "error":
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
          default:
            break;
        }
      }

      if (toolCalls.length === 0) {
        yield { type: "turn_complete", message: sealTurn(false) };
        return { reason: "complete" };
      }

      for (const toolCall of toolCalls) {
        if (abortSignal?.aborted) break;
        yield { type: "tool_call", toolCall };
        let outcome: ToolOutcome;
        try {
          outcome = await runTool(toolCall);
        } catch (err) {
          outcome = {
            kind: "error",
            errorText: err instanceof Error ? err.message : String(err),
          };
        }
        const toolPart = assistant.parts.find(
          (p) => (p as never as ToolPart).toolCallId === toolCall.toolCallId,
        ) as never as ToolPart | undefined;
        if (toolPart) {
          if (outcome.kind === "output") {
            toolPart.state = "output-available";
            toolPart.output = outcome.output;
          } else {
            toolPart.state = "output-error";
            toolPart.errorText = outcome.errorText;
          }
        }
        trackToolSearchLoads(toolCall, outcome, loadedDeferred);
        yield { type: "tool_result", toolCallId: toolCall.toolCallId, outcome };
        yield { type: "message_update", message: snapshot(assistant) };
      }

      if (abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }
      // next round continues with the same assistant message accumulating parts
    }
    yield { type: "turn_complete", message: sealTurn(false) };
    return { reason: "max_rounds" };
  } catch (err) {
    const aborted =
      abortSignal?.aborted ||
      (err instanceof Error && err.name === "AbortError");
    yield { type: "turn_complete", message: sealTurn(true) };
    return aborted ? { reason: "aborted" } : { reason: "error", error: err };
  }
}
```

- [ ] **Step 5.4: Run tests; fix stream-part field names against the installed `ai` types** (`text-delta` may carry `.text` or `.delta`; `finish` carries `.totalUsage`; check `node_modules/ai/dist/index.d.ts` for `TextStreamPart`). Iterate until:

```bash
bun test packages/cli/src/lib/engine/query.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5.5: Typecheck + full test suite:**

```bash
cd packages/cli; bun run check-types; cd ../..; bun test packages/cli
```
Expected: clean.

- [ ] **Step 5.6: Commit:**

```bash
git add packages/cli/src/lib/engine/query.ts packages/cli/src/lib/engine/query.test.ts
git commit -m "feat(cli): add standalone query engine loop"
```

---

## Task 6: `engine/tool-runner.ts` — gating decisions + loop guard (TDD)

Ports the decision logic from `use-chat.ts` `onToolCall` (lines 770–915) into a pure, testable module. The hook supplies the side-effectful pieces.

**Files:**
- Create: `packages/cli/src/lib/engine/tool-runner.ts`
- Test: `packages/cli/src/lib/engine/tool-runner.test.ts`

- [ ] **Step 6.1: Write the failing tests:**

```ts
import { describe, expect, test } from "bun:test";
import { gateToolCall, ToolLoopGuard } from "./tool-runner";

const gate = (
  toolName: string,
  input: unknown,
  mode: "BUILD" | "PLAN" | "AUTO" = "BUILD",
  opts?: { alwaysAllowEdits?: boolean; isCommandAllowed?: (c: string) => boolean },
) =>
  gateToolCall({
    toolName,
    input,
    mode,
    alwaysAllowEdits: opts?.alwaysAllowEdits ?? false,
    isCommandAllowed: opts?.isCommandAllowed ?? (() => false),
  });

describe("gateToolCall", () => {
  test("TodoWrite is always 'todo'", () => {
    expect(gate("TodoWrite", { todos: [] })).toBe("todo");
    expect(gate("TodoWrite", { todos: [] }, "AUTO")).toBe("todo");
  });

  test("file edits need confirmation unless alwaysAllowEdits or AUTO", () => {
    for (const t of ["Edit", "MultiEdit", "Write", "NotebookEdit"]) {
      expect(gate(t, {})).toBe("confirm");
      expect(gate(t, {}, "AUTO")).toBe("execute");
      expect(gate(t, {}, "BUILD", { alwaysAllowEdits: true })).toBe("execute");
    }
  });

  test("Bash gated by allowlist outside AUTO", () => {
    expect(gate("Bash", { command: "rm -rf x" })).toBe("confirm");
    expect(
      gate("Bash", { command: "ls" }, "BUILD", { isCommandAllowed: () => true }),
    ).toBe("execute");
    expect(gate("Bash", { command: "rm -rf x" }, "AUTO")).toBe("execute");
  });

  test("AskUserQuestion always confirms (question), even in AUTO", () => {
    expect(gate("AskUserQuestion", {})).toBe("confirm");
    expect(gate("AskUserQuestion", {}, "AUTO")).toBe("confirm");
  });

  test("Config: writes confirm, reads execute", () => {
    expect(gate("Config", { key: "model", value: "x" })).toBe("confirm");
    expect(gate("Config", { key: "model" })).toBe("execute");
    expect(gate("Config", { key: "model", value: "x" }, "AUTO")).toBe("execute");
  });

  test("Agent confirms outside AUTO", () => {
    expect(gate("Agent", {})).toBe("confirm");
    expect(gate("Agent", {}, "AUTO")).toBe("execute");
  });

  test("read-only tools execute", () => {
    expect(gate("Read", { file_path: "x" })).toBe("execute");
    expect(gate("Grep", { pattern: "x" })).toBe("execute");
  });
});

describe("ToolLoopGuard", () => {
  test("rejects the 9th identical call; TodoWrite exempt", () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 8; i++) {
      expect(guard.check("Grep", { pattern: "x" })).toBe(true);
    }
    expect(guard.check("Grep", { pattern: "x" })).toBe(false);
    expect(guard.check("Grep", { pattern: "y" })).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(guard.check("TodoWrite", { todos: [] })).toBe(true);
    }
  });

  test("reset clears counts", () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 9; i++) guard.check("Grep", { pattern: "x" });
    guard.reset();
    expect(guard.check("Grep", { pattern: "x" })).toBe(true);
  });
});
```

- [ ] **Step 6.2: Run to verify failure:**

```bash
bun test packages/cli/src/lib/engine/tool-runner.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `tool-runner.ts`:**

```ts
import type { ModeType } from "@repo/shared";

export type ToolGateDecision = "execute" | "confirm" | "todo";

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * Pure gating decision, ported from use-chat's onToolCall. AUTO mode
 * short-circuits every permission gate except AskUserQuestion (a question is
 * not a permission — the model explicitly wants user input).
 */
export function gateToolCall(opts: {
  toolName: string;
  input: unknown;
  mode: ModeType;
  alwaysAllowEdits: boolean;
  isCommandAllowed: (command: string) => boolean;
}): ToolGateDecision {
  const { toolName, input, mode, alwaysAllowEdits, isCommandAllowed } = opts;

  if (toolName === "TodoWrite") return "todo";
  if (toolName === "AskUserQuestion") return "confirm";
  if (mode === "AUTO") return "execute";

  if (FILE_EDIT_TOOLS.has(toolName) && !alwaysAllowEdits) return "confirm";
  if (toolName === "Bash") {
    const command = String((input as { command?: unknown })?.command ?? "");
    if (!isCommandAllowed(command)) return "confirm";
    return "execute";
  }
  if (
    toolName === "Config" &&
    (input as { value?: unknown })?.value !== undefined
  ) {
    return "confirm";
  }
  if (toolName === "Agent") return "confirm";

  return "execute";
}

const LOOP_LIMIT = 8;

/** Per-turn repeated-call guard (toolName + serialized input). */
export class ToolLoopGuard {
  private counts = new Map<string, number>();

  /** Returns false when the call should be rejected as a loop. */
  check(toolName: string, input: unknown): boolean {
    if (toolName === "TodoWrite") return true;
    const key = `${toolName}:${JSON.stringify(input ?? {})}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count <= LOOP_LIMIT;
  }

  reset(): void {
    this.counts.clear();
  }
}

export const LOOP_PROTECTION_ERROR =
  "Loop protection stopped this repeated tool call. Adjust the input or ask the user before retrying.";
```

- [ ] **Step 6.4: Run tests:**

```bash
bun test packages/cli/src/lib/engine/tool-runner.test.ts
```
Expected: PASS.

> Behavior note vs today: in current code, `Bash` in BUILD mode with a non-allowlisted command goes to confirmation and AUTO bypasses it — preserved. `AskUserQuestion` currently also prompts in AUTO (no `mode !== "AUTO"` guard at `use-chat.ts:847`) — preserved here by checking it before the AUTO short-circuit.

- [ ] **Step 6.5: Commit:**

```bash
git add packages/cli/src/lib/engine/tool-runner.ts packages/cli/src/lib/engine/tool-runner.test.ts
git commit -m "feat(cli): add tool gating decisions and loop guard"
```

---

## Task 7: Extract `compactHistory` into `hooks/compact-history.ts`

Mechanical move so the new hook stays readable. No behavior change in this task.

**Files:**
- Create: `packages/cli/src/hooks/compact-history.ts`
- Modify: `packages/cli/src/hooks/use-chat.ts`

- [ ] **Step 7.1: Create `compact-history.ts`** exporting a factory with this exact signature; move the bodies of `estimateTokensForText`, `estimateTokensForMessages` (`use-chat.ts:302-339`) and the entire `compactHistory` callback body (`use-chat.ts:341-689`) verbatim, replacing `chatRef.current.messages` reads with `deps.getMessages()`, `chatRef.current.setMessages(x)` with `deps.setMessages(x)`, `toast.show` with `deps.toast`, and the `isCompactingRef`/`setIsCompacting` pair with `deps.setCompacting(boolean)` guarded by an internal `running` flag:

```ts
import type { SupportedChatModelId } from "@repo/shared";
import type { Message } from "../lib/engine/messages";

export type CompactHistoryDeps = {
  sessionId: string;
  getMessages: () => Message[];
  setMessages: (messages: Message[]) => void;
  setCompacting: (compacting: boolean) => void;
  toast: (opts: { variant: "success" | "info" | "error"; message: string }) => void;
};

export function createCompactHistory(
  deps: CompactHistoryDeps,
): (force?: boolean, targetModelId?: SupportedChatModelId) => Promise<void> {
  let running = false;
  return async function compactHistory(force = false, targetModelId) {
    if (running) return;
    running = true;
    try {
      // ... moved body ...
    } finally {
      deps.setCompacting(false);
      running = false;
    }
  };
}
```

- [ ] **Step 7.2: Rewire `use-chat.ts`** to use `createCompactHistory` (build deps from `chatRef`/`toast`/`setIsCompacting`), deleting the moved code from the hook. This keeps the old path working until Task 9 deletes it.

- [ ] **Step 7.3: Typecheck + tests:**

```bash
cd packages/cli; bun run check-types; cd ../..; bun test packages/cli
```
Expected: clean.

- [ ] **Step 7.4: Commit:**

```bash
git add packages/cli/src/hooks/compact-history.ts packages/cli/src/hooks/use-chat.ts
git commit -m "refactor(cli): extract compactHistory from use-chat"
```

---

## Task 8: `hooks/use-query-engine.ts` — the replacement hook

**Files:**
- Create: `packages/cli/src/hooks/use-query-engine.ts`

The hook reproduces `useChat`'s exact return surface (consumed by `screens/session.tsx:160-174`): `messages, status, error, activeTurnStartMs, getTurnPausedMs, pendingConfirmations, confirmToolCall, setConfirmationModelOverride, requestToolPermission, answerQuestion, compact, clearMessages, rewindMessages, isCompacting, submit, abort, interrupt`.

- [ ] **Step 8.1: Create the hook.** Full implementation (port comments where logic is moved):

```ts
import {
  type ModeType,
  type ReasoningEffortLevel,
  type SupportedChatModelId,
} from "@repo/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dequeueNotification,
  hasNotifications,
} from "../lib/tools/Agent/notifications";
import { query } from "../lib/engine/query";
import type { ToolCallRequest, ToolOutcome } from "../lib/engine/events";
import type { Message, PendingConfirmation } from "../lib/engine/messages";
import { repairTranscript } from "../lib/engine/transcript";
import {
  gateToolCall,
  LOOP_PROTECTION_ERROR,
  ToolLoopGuard,
} from "../lib/engine/tool-runner";
import { getOpenRouterApiKey } from "../lib/credentials";
import {
  runStopHooks,
  runUserPromptSubmitHooks,
  type UserPromptHookResult,
} from "../lib/hooks";
import { allowCommand, isCommandAllowed } from "../lib/permissions/permissions";
import { getStore } from "../lib/store/client";
import { ensureSession, replaceSessionMessages } from "../lib/store/conversation";
import { executeLocalTool } from "../lib/tools";
import { useTodo, type TodoItem } from "../providers/todo";
import { useToast } from "../providers/toast";
import { createCompactHistory } from "./compact-history";

export type { Message, PendingConfirmation } from "../lib/engine/messages";

type Status = "ready" | "submitted" | "streaming" | "error";

type ConfirmDecision = {
  allowed: boolean;
  always: boolean;
  feedback?: string;
  modelOverride?: SupportedChatModelId;
};

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export function useQueryEngine(
  sessionId: string,
  initialMessages: Message[],
  options?: { onModeChange?: (mode: ModeType) => void },
) {
  const toast = useToast();
  // Repair on load so resumed sessions render interrupted markers and never
  // replay unresolved tool calls.
  const [messages, setMessages] = useState<Message[]>(() =>
    repairTranscript(initialMessages),
  );
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState<Error | undefined>(undefined);
  const [pendingConfirmations, setPendingConfirmations] = useState<
    PendingConfirmation[]
  >([]);
  const [isCompacting, setIsCompacting] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const abortRef = useRef<AbortController | null>(null);
  const loopGuardRef = useRef(new ToolLoopGuard());
  const alwaysAllowEditsRef = useRef(false);
  // Resolvers for confirmation prompts keyed by toolCallId. AskUserQuestion
  // resolves with answers via answerQuestion instead.
  const confirmResolversRef = useRef(new Map<string, (d: ConfirmDecision) => void>());
  const questionResolversRef = useRef(
    new Map<string, (answers: { answers: unknown }) => void>(),
  );
  // Foreground-subagent permission requests (boolean resolvers).
  const permissionResolversRef = useRef(new Map<string, (allowed: boolean) => void>());

  // Turn-clock pause while a prompt/question is up (ported from use-chat).
  const turnPausedMsRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const getTurnPausedMs = useCallback(() => {
    const live =
      pauseStartRef.current !== null ? Date.now() - pauseStartRef.current : 0;
    return turnPausedMsRef.current + live;
  }, []);
  useEffect(() => {
    if (pendingConfirmations.length > 0) {
      if (pauseStartRef.current === null) pauseStartRef.current = Date.now();
    } else if (pauseStartRef.current !== null) {
      turnPausedMsRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
  }, [pendingConfirmations.length]);

  const { setItems: setTodoItems } = useTodo();
  const todoRef = useRef(setTodoItems);
  todoRef.current = setTodoItems;

  const compactHistory = useMemo(
    () =>
      createCompactHistory({
        sessionId,
        getMessages: () => messagesRef.current,
        setMessages: (m) => setMessages(m),
        setCompacting: setIsCompacting,
        toast: (t) => toast.show(t),
      }),
    [sessionId, toast],
  );

  const persist = useCallback(
    (finalMessages: Message[], modelId: string, reasoningEffort: string) => {
      try {
        const firstUserText = finalMessages
          .find((m) => m.role === "user")
          ?.parts.find(
            (p): p is { type: "text"; text: string } => p.type === "text",
          )?.text;
        ensureSession(getStore(), {
          id: sessionId,
          directory: process.cwd(),
          title: firstUserText?.slice(0, 100) || "Untitled",
          model: modelId,
          reasoningEffort,
        });
        replaceSessionMessages(getStore(), sessionId, finalMessages as never);
      } catch (err) {
        console.error("Failed to persist conversation:", err);
      }
    },
    [sessionId],
  );

  /** Await a user decision for a gated tool call. */
  const requestConfirmation = useCallback(
    (toolCall: ToolCallRequest, mode: ModeType): Promise<ConfirmDecision> =>
      new Promise((resolve) => {
        confirmResolversRef.current.set(toolCall.toolCallId, resolve);
        setPendingConfirmations((prev) => [
          ...prev,
          { toolCallId: toolCall.toolCallId, toolCall: toolCall as never, mode },
        ]);
      }),
    [],
  );

  /** Boolean variant used by foreground subagents (ported from use-chat). */
  const requestToolPermission = useCallback(
    (
      toolCall: { toolCallId: string; toolName: string; input: unknown },
      mode: ModeType,
    ): Promise<boolean> =>
      new Promise((resolve) => {
        permissionResolversRef.current.set(toolCall.toolCallId, resolve);
        setPendingConfirmations((prev) => [
          ...prev,
          { toolCallId: toolCall.toolCallId, toolCall: toolCall as never, mode },
        ]);
      }),
    [],
  );

  const removePending = useCallback((toolCallId: string) => {
    setPendingConfirmations((prev) =>
      prev.filter((c) => c.toolCallId !== toolCallId),
    );
  }, []);

  /** Engine runTool: gating + execution. Never throws for ordinary failures. */
  const makeRunTool = useCallback(
    (mode: ModeType) =>
      async (toolCall: ToolCallRequest): Promise<ToolOutcome> => {
        if (!loopGuardRef.current.check(toolCall.toolName, toolCall.input)) {
          return { kind: "error", errorText: LOOP_PROTECTION_ERROR };
        }

        const decision = gateToolCall({
          toolName: toolCall.toolName,
          input: toolCall.input,
          mode,
          alwaysAllowEdits: alwaysAllowEditsRef.current,
          isCommandAllowed,
        });

        if (decision === "todo") {
          const { todos } = toolCall.input as {
            todos: Array<{
              content: string;
              active_form?: string;
              status: "pending" | "in_progress" | "completed";
            }>;
          };
          const items: TodoItem[] = todos.map((t, idx) => ({
            id: String(idx),
            label:
              t.status === "in_progress" && t.active_form
                ? t.active_form
                : t.content,
            status: t.status,
          }));
          todoRef.current(items, true);
          return {
            kind: "output",
            output: { success: true, itemCount: items.length },
          };
        }

        let modelOverride: SupportedChatModelId | undefined;
        if (decision === "confirm") {
          if (toolCall.toolName === "AskUserQuestion") {
            const answers = await new Promise<{ answers: unknown }>((resolve) => {
              questionResolversRef.current.set(toolCall.toolCallId, resolve);
              setPendingConfirmations((prev) => [
                ...prev,
                {
                  toolCallId: toolCall.toolCallId,
                  toolCall: toolCall as never,
                  mode,
                },
              ]);
            });
            return { kind: "output", output: answers };
          }

          const d = await requestConfirmation(toolCall, mode);
          if (!d.allowed) {
            return {
              kind: "error",
              errorText: d.feedback?.trim()
                ? `User declined this change. Guidance: ${d.feedback.trim()}`
                : "User rejected the changes",
            };
          }
          if (d.always) {
            if (toolCall.toolName === "Bash") {
              const command = (toolCall.input as { command?: string })?.command;
              if (typeof command === "string" && command.trim()) {
                allowCommand(command);
              }
            } else if (FILE_EDIT_TOOLS.has(toolCall.toolName)) {
              alwaysAllowEditsRef.current = true;
            }
          }
          modelOverride = d.modelOverride;
        }

        try {
          const output = await executeLocalTool(
            toolCall.toolName,
            toolCall.input,
            mode,
            sessionId,
            {
              modelOverride,
              requestToolPermission: (tc) => requestToolPermission(tc, mode),
            },
          );
          if (output && typeof output === "object" && "modeTransition" in output) {
            options?.onModeChange?.(
              (output as { modeTransition: ModeType }).modeTransition,
            );
          }
          return { kind: "output", output };
        } catch (err) {
          return {
            kind: "error",
            errorText: err instanceof Error ? err.message : String(err),
          };
        }
      },
    [sessionId, options?.onModeChange, requestConfirmation, requestToolPermission],
  );

  const confirmToolCall = useCallback(
    (toolCallId: string, allowed: boolean, always: boolean, feedback?: string) => {
      removePending(toolCallId);
      // Foreground-subagent boolean resolver takes precedence (as today).
      const permResolver = permissionResolversRef.current.get(toolCallId);
      if (permResolver) {
        permissionResolversRef.current.delete(toolCallId);
        permResolver(allowed);
        return;
      }
      const resolver = confirmResolversRef.current.get(toolCallId);
      if (!resolver) return;
      confirmResolversRef.current.delete(toolCallId);
      const pending = pendingConfirmationsRef.current.find(
        (c) => c.toolCallId === toolCallId,
      );
      resolver({ allowed, always, feedback, modelOverride: pending?.modelOverride });
      // "Always" for a file edit auto-approves the other pending file edits
      // (ported from use-chat.ts:215-230). Their resolvers are awaiting too.
      if (allowed && always) {
        const pendingNow = pendingConfirmationsRef.current.filter(
          (c) =>
            c.toolCallId !== toolCallId &&
            FILE_EDIT_TOOLS.has(c.toolCall.toolName),
        );
        for (const other of pendingNow) {
          const r = confirmResolversRef.current.get(other.toolCallId);
          if (r) {
            confirmResolversRef.current.delete(other.toolCallId);
            removePending(other.toolCallId);
            r({ allowed: true, always: false });
          }
        }
      }
    },
    [removePending],
  );
  const pendingConfirmationsRef = useRef(pendingConfirmations);
  pendingConfirmationsRef.current = pendingConfirmations;

  const setConfirmationModelOverride = useCallback(
    (toolCallId: string, modelId: SupportedChatModelId | undefined) => {
      setPendingConfirmations((prev) =>
        prev.map((c) =>
          c.toolCallId === toolCallId ? { ...c, modelOverride: modelId } : c,
        ),
      );
    },
    [],
  );

  const answerQuestion = useCallback(
    (
      toolCallId: string,
      answers: Array<{ question: string; answer: string | string[] }>,
    ) => {
      removePending(toolCallId);
      const resolver = questionResolversRef.current.get(toolCallId);
      if (!resolver) return;
      questionResolversRef.current.delete(toolCallId);
      resolver({ answers });
    },
    [removePending],
  );

  const submit = useCallback(
    async (params: {
      userText: string;
      mode: ModeType;
      model: SupportedChatModelId;
      reasoningEffort: ReasoningEffortLevel;
      commandProgressMessage?: string;
    }) => {
      if (abortRef.current) return; // one turn at a time

      let promptHookResult: UserPromptHookResult;
      try {
        promptHookResult = await runUserPromptSubmitHooks(
          params.userText,
          sessionId,
        );
      } catch (err) {
        console.error("UserPromptSubmit hook error:", err);
        promptHookResult = { blocked: false };
      }
      if (promptHookResult.blocked) {
        toast.show({
          variant: "error",
          message: promptHookResult.stopReason ?? "Hook blocked this message",
        });
        return;
      }

      loopGuardRef.current.reset();
      turnPausedMsRef.current = 0;
      pauseStartRef.current = null;
      setError(undefined);
      await compactHistory(false, params.model);

      const submittedAt = Date.now();
      const userMessage: Message = {
        id: `user-${crypto.randomUUID()}`,
        role: "user",
        parts: [{ type: "text", text: params.userText }],
        metadata: {
          mode: params.mode,
          model: params.model,
          reasoningEffort: params.reasoningEffort,
          submittedAt,
          ...(params.commandProgressMessage
            ? { commandProgressMessage: params.commandProgressMessage }
            : {}),
        },
      } as Message;

      const base = [...messagesRef.current, userMessage];
      setMessages(base);
      setStatus("submitted");

      const ac = new AbortController();
      abortRef.current = ac;

      const gen = query({
        sessionId,
        cwd: process.cwd(),
        messages: base,
        mode: params.mode,
        modelId: params.model,
        reasoningEffort: params.reasoningEffort,
        getApiKey: getOpenRouterApiKey,
        runTool: makeRunTool(params.mode),
        abortSignal: ac.signal,
        turnStartMs: submittedAt,
        getTurnPausedMs,
      });

      try {
        let assistantId: string | null = null;
        const upsertAssistant = (message: Message) => {
          assistantId = message.id;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === message.id);
            if (idx === -1) return [...prev, message];
            const next = [...prev];
            next[idx] = message;
            return next;
          });
        };

        while (true) {
          const r = await gen.next();
          if (r.done) {
            if (r.value.reason === "error") {
              setError(
                r.value.error instanceof Error
                  ? r.value.error
                  : new Error(String(r.value.error)),
              );
              setStatus("error");
            }
            break;
          }
          const event = r.value;
          switch (event.type) {
            case "stream_start":
              setStatus("streaming");
              break;
            case "message_update":
            case "turn_complete":
              upsertAssistant(event.message);
              break;
            default:
              break;
          }
        }

        persist(messagesRef.current, params.model, params.reasoningEffort);
        void compactHistory(false, params.model);
        setTimeout(() => {
          runStopHooks(sessionId).catch((err) =>
            console.error("Stop hook error:", err),
          );
        }, 0);
      } finally {
        abortRef.current = null;
        setStatus((s) => (s === "error" ? s : "ready"));
        setPendingConfirmations([]);
        confirmResolversRef.current.clear();
        questionResolversRef.current.clear();
        permissionResolversRef.current.clear();
      }
    },
    [
      sessionId,
      toast,
      compactHistory,
      makeRunTool,
      getTurnPausedMs,
      persist,
    ],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    // Unblock any prompt the engine is awaiting so the turn can wind down.
    for (const [id, r] of confirmResolversRef.current) {
      r({ allowed: false, always: false });
      confirmResolversRef.current.delete(id);
    }
    for (const [id, r] of permissionResolversRef.current) {
      r(false);
      permissionResolversRef.current.delete(id);
    }
    setPendingConfirmations([]);
  }, []);

  const clearMessages = useCallback(async () => {
    setMessages([]);
    try {
      replaceSessionMessages(getStore(), sessionId, []);
    } catch (err) {
      console.error("Failed to clear messages:", err);
    }
  }, [sessionId]);

  // rewindMessages: ported verbatim from use-chat.ts:701-764, with
  // chatRef.current.messages → messagesRef.current and
  // chatRef.current.setMessages → setMessages.
  const rewindMessages = useCallback(
    async (n: number) => {
      const current: Message[] = messagesRef.current;
      if (current.length === 0 || n <= 0) return;
      const pairs: [number, number][] = [];
      let i = current.length - 1;
      while (i >= 0 && pairs.length < n) {
        const msg = current[i];
        if (!msg) {
          i--;
          continue;
        }
        if (msg.role === "assistant") {
          let j = i - 1;
          while (j >= 0 && current[j]?.role !== "user") j--;
          if (j >= 0) {
            pairs.push([j, i]);
            i = j - 1;
          } else {
            i--;
          }
        } else {
          i--;
        }
      }
      if (pairs.length === 0) return;
      const removeIndices = new Set(pairs.flatMap(([u, a]) => [u, a]));
      const next = current.filter((_, idx) => !removeIndices.has(idx));
      setMessages(next);
      try {
        replaceSessionMessages(getStore(), sessionId, next as never);
      } catch (err) {
        console.error("Failed to persist rewound messages:", err);
      }
    },
    [sessionId],
  );

  // Background-agent notifications: drain one per idle tick (ported).
  useEffect(() => {
    if (status !== "ready") return;
    if (pendingConfirmations.length > 0) return;
    if (!hasNotifications()) return;
    const next = dequeueNotification();
    if (!next) return;
    const meta = messagesRef.current.findLast((m) => m.metadata?.model)?.metadata;
    void submit({
      userText: next,
      mode: (meta?.mode ?? "BUILD") as ModeType,
      model: (meta?.model ?? "") as SupportedChatModelId,
      reasoningEffort: (meta?.reasoningEffort ?? "medium") as ReasoningEffortLevel,
    });
  }, [status, pendingConfirmations.length, submit]);

  const activeTurnStartMs = messages.findLast((m) => m.role === "user")
    ?.metadata?.submittedAt;

  return {
    messages,
    status,
    error,
    activeTurnStartMs,
    getTurnPausedMs,
    pendingConfirmations,
    confirmToolCall,
    setConfirmationModelOverride,
    requestToolPermission,
    answerQuestion,
    compact: () => compactHistory(true),
    clearMessages,
    rewindMessages,
    isCompacting,
    submit,
    abort,
    interrupt: abort,
  };
}
```

Two intentional fixes vs `use-chat` to note in the commit body:
- Notification drain previously called `chat.sendMessage({ text })` with no metadata; here it reuses the last turn's mode/model (closest equivalent that satisfies `submit`'s signature).
- `abort` now also resolves outstanding permission prompts as denied so the turn always terminates (today an abandoned prompt leaks).

- [ ] **Step 8.2: Typecheck:**

```bash
cd packages/cli; bun run check-types; cd ../..
```
Expected: clean. (The hook isn't wired in yet; `bun test packages/cli` must also stay green.)

- [ ] **Step 8.3: Commit:**

```bash
git add packages/cli/src/hooks/use-query-engine.ts
git commit -m "feat(cli): add useQueryEngine hook driving the engine loop"
```

---

## Task 9: Swap `session.tsx`, delete the old harness

**Files:**
- Modify: `packages/cli/src/screens/session.tsx`
- Delete: `packages/cli/src/hooks/use-chat.ts`, `packages/cli/src/lib/inference/local-chat-transport.ts`
- Modify: `packages/cli/package.json` (drop `@ai-sdk/react`)

- [ ] **Step 9.1: In `session.tsx`** replace `import { useChat } from "../hooks/use-chat"` with `import { useQueryEngine } from "../hooks/use-query-engine"` and the call `useChat(session.id, initialMessages, { onModeChange: setMode })` with `useQueryEngine(...)` (same args, same destructure — the surface is identical).

- [ ] **Step 9.2: Find any remaining `use-chat` imports and repoint or remove:**

```bash
grep -rn "use-chat" packages/cli/src --include=*.ts --include=*.tsx
```
Expected leftovers: type imports already moved in Task 2 (none should remain). Fix any stragglers to `lib/engine/messages` or `hooks/use-query-engine`.

- [ ] **Step 9.3: Delete the old files:**

```bash
git rm packages/cli/src/hooks/use-chat.ts packages/cli/src/lib/inference/local-chat-transport.ts
```

- [ ] **Step 9.4: Remove `@ai-sdk/react`** from `packages/cli/package.json` dependencies, then:

```bash
bun install
```

- [ ] **Step 9.5: Typecheck + full suite:**

```bash
cd packages/cli; bun run check-types; cd ../..; bun test packages/cli
```
Expected: clean. If `local-chat-transport` or `use-chat` had tests, they were deleted with their subjects; everything else green.

- [ ] **Step 9.6: Manual smoke test (REQUIRED — use the superpowers:verification-before-completion skill before claiming done).** Run the CLI and verify each:

```bash
bun run --cwd packages/cli dev
```
  1. Plain question → streams text, completes, duration shown.
  2. "Read package.json and summarize" → Read executes without prompt, second round streams.
  3. "Create a file scratch-test.txt with hello" in BUILD mode → Edit confirmation prompt appears; approve; file created; `/undo` restores.
  4. Ask something, press Esc mid-stream → turn stops, interrupted marker renders, next prompt works (no "tool results missing" error).
  5. Ctrl+C/restart, resume the session → transcript loads, no provider rejection on next message.
  6. `/clear` and `/rewind` work.
  7. TodoWrite-triggering prompt ("plan a 3-step refactor and track todos") → todo panel updates.

- [ ] **Step 9.7: Commit:**

```bash
git add -A
git commit -m "feat(cli): replace useChat harness with standalone query engine"
```

---

## Task 10: Final verification + handoff

- [ ] **Step 10.1: Full repo checks:**

```bash
bun test
cd packages/cli; bun run check-types; cd ../..
bun run lint 2>/dev/null || true   # if a lint script exists at root
```
Expected: all green.

- [ ] **Step 10.2: Review the diff as a whole:**

```bash
git log --oneline main..engine-phase-1
git diff main...engine-phase-1 --stat
```
Confirm: no spec/plan/docs committed, no stray debug code, commit messages clean (no attribution trailers).

- [ ] **Step 10.3: Hand off.** Use the superpowers:finishing-a-development-branch skill. The user opens the PR themselves (CodeRabbit + Codex review). Do not merge.

---

## Self-review checklist (run after writing, before executing)

- Spec coverage for Phase 0+1: comparison doc (Task 0) ✔; engine skeleton + events (Tasks 3, 5) ✔; transcript integrity incl. restore repair (Task 4 + hook init) ✔; `useQueryEngine` swap + interrupted marker (Tasks 8–9; marker renders via existing `interrupted-message.tsx` keyed off `metadata.isInterrupted`) ✔; useChat/LocalChatTransport removed (Task 9) ✔; loop protection carried (Task 6, intentional early-pull) ✔; persistence on turn_complete via `replaceSessionMessages` ✔; turn timing + pause ✔; usage accumulation ✔; deferred-tool tracking in engine state ✔.
- Phase 2+ items intentionally absent: scheduler/parallelism, canUseTool-in-engine, engine hooks module, context per-turn caching, boundary compaction, subagent streaming.
- Type consistency: `ToolOutcome`/`ToolCallRequest`/`EngineEvent` defined once in `events.ts` and imported everywhere; `Message` from `engine/messages.ts`.
