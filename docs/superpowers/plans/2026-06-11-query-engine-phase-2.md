# Query Engine — Phase 2 (Scheduler + Engine-Owned Policy + Hooks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tool execution out of the UI hook and into the engine: a concurrency-aware scheduler (contiguous safe calls run in parallel, unsafe serialize), the permission policy evaluated inside the engine via an injected `canUseTool` callback, the 5-event hook system owned by the scheduler (with PostToolUse `systemMessage`s finally reaching the model), and engine-tracked mode (`mode_change` event). UI lockstep: per-row spinners on concurrently running tools, permission prompts driven by engine requests, parallel agent rows.

**Architecture:** New `engine/scheduler.ts` exposes `runToolCalls()` — an async generator that partitions a round's tool calls into batches by `is_concurrency_safe` (already on every `@repo/shared` contract), runs safe batches concurrently (cap 10) and unsafe calls serially, and pushes every call through one pipeline: loop guard → central zod parse → PreToolUse hooks → gate (`gateToolCall`, unchanged) → `canUseTool`/`askQuestion` UI callbacks → `executeTool` → PostToolUse hooks. Every path produces a `ToolOutcome` — the scheduler, not callers, guarantees tool_use/tool_result pairing. `query.ts` consumes scheduler events, tracks the current mode in State (EnterPlanMode/ExitPlanMode transition mid-turn now actually changes the toolset and gating for later rounds), and injects collected hook `systemMessage`s into the next round as a request-view-only `<system-reminder>`. `useQueryEngine` shrinks: its `makeRunTool` (gating + loop guard + always-allow bookkeeping) is replaced by a thin `ToolHost` (execute / confirm / question / bash-allowlist callbacks).

**Tech Stack:** Bun, TypeScript, `ai` v6 core, `ai/test` (`MockLanguageModelV3`), bun:test, OpenTUI/React.

**Spec:** `docs/superpowers/specs/2026-06-10-query-engine-design.md` (§engine/scheduler.ts, §engine/hooks.ts, §Error handling). Comparison doc: `docs/harness-comparison.md` §3–§4 (all ADOPT-P2 rows). Read both first.

**Rules for this repo (from the user, non-negotiable):**
- Do NOT commit this plan or the spec. Code commits only.
- Never add Claude attribution / `Co-Authored-By` trailers to commit messages.
- Work on branch `engine-scheduler`. The user opens PRs themselves.
- Test command (repo root): `bun test packages/cli` / `bun test packages/shared`. Typecheck: `bun run check-types` inside `packages/cli` (and `packages/shared` has its own).

**Locked decisions (intentional, do not re-litigate while executing):**
1. **Static `is_concurrency_safe` boolean**, not claude-code's input-dependent `isConcurrencySafe(input)` — knightcode serializes Bash always, so the input-dependent case (parsing bash commands for read-only-ness) doesn't arise. Flags are corrected to the spec table (Task 2).
2. **PreToolUse hooks now run BEFORE the permission prompt** (claude-code's order). Today they run after confirmation (inside `executeLocalTool`); a hook block no longer wastes a user prompt. Same terminal outcome (error tool_result).
3. **Hook `systemMessage` injection is request-view only** — accumulated per turn into one synthetic user message, never persisted to the store. Persistent attachments are Phase 3+ work.
4. **Loop protection moves into the engine** (one `ToolLoopGuard` per `query()` call = per turn, same lifetime as today's reset-per-submit).
5. **TodoWrite and AskUserQuestion stay UI-implemented** — the scheduler routes them (`todo` gate → plain execute via the host's TodoWrite branch; AskUserQuestion → `askQuestion` callback) but the React hook still owns the todo panel and question prompts.
6. **Stop hooks stay in `useQueryEngine`** (fired when the generator finishes, as Phase 1 left them). The spec's blocking-continue Stop semantics are LATER.
7. **No `permission_request`/`question_request` engine events** — the awaited `canUseTool`/`askQuestion` callbacks subsume them (Phase 1 made the same event-pruning call for snapshots).
8. **Background subagents are untouched**: `Agent/execute.ts` + `run-subagent.ts` keep calling `executeLocalTool` (the hook-running wrapper). Engine-recursive subagents are Phase 5.
9. **Abort contract unchanged**: abort stops scheduling further calls; in-flight executions run to completion; `sealTurn` synthesizes interrupted results for never-started calls.

---

## Task 1: Branch setup

- [ ] **Step 1.1:**

```bash
git checkout main && git pull && git checkout -b engine-scheduler
```

---

## Task 2: Correct `is_concurrency_safe` flags in `@repo/shared` (TDD)

The flags exist on every contract but 7 disagree with the spec's locked table. Spec table (design doc §engine/scheduler.ts):

| Safe (parallel) | Unsafe (serialize) |
|---|---|
| Read, Glob, Grep, WebFetch, WebSearch, TaskList, TaskGet, TaskOutput, ToolSearch, Skill, TodoWrite, **Agent** | Edit, MultiEdit, Write, NotebookEdit, Bash, TaskCreate, TaskUpdate, TaskStop, Config, EnterPlanMode, ExitPlanMode, AskUserQuestion |

Current code disagrees on: TodoWrite (false→**true**), Skill (false→**true**), Agent (false→**true**), Config (true→**false**), TaskCreate (true→**false**), TaskUpdate (true→**false**), TaskStop (true→**false**).

**Files:**
- Test: `packages/shared/src/tools/concurrency.test.ts` (create)
- Modify: `packages/shared/src/tools/TodoWrite/index.ts`, `Skill/index.ts`, `Agent/index.ts`, `Config/index.ts`, `TaskCreate/index.ts`, `TaskUpdate/index.ts`, `TaskStop/index.ts` (one line each)

- [ ] **Step 2.1: Write the failing test** — `packages/shared/src/tools/concurrency.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { ALL_TOOLS, ALL_TOOL_NAMES } from "./index";

// Locked Phase-2 concurrency table (query-engine design spec). Agent being
// safe is what makes subagents parallel; Config writes settings; the Task*
// mutators write the task store; mode-transition tools mutate gating for
// subsequent calls.
const CONCURRENCY_SAFE = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "ToolSearch",
  "Skill",
  "TodoWrite",
  "Agent",
]);

describe("is_concurrency_safe flags", () => {
  test("every tool matches the locked scheduler table", () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(`${name}:${ALL_TOOLS[name]!.is_concurrency_safe}`).toBe(
        `${name}:${CONCURRENCY_SAFE.has(name)}`,
      );
    }
  });

  test("table covers exactly the registered tools (no drift)", () => {
    for (const name of CONCURRENCY_SAFE) {
      expect(ALL_TOOL_NAMES).toContain(name);
    }
  });
});
```

- [ ] **Step 2.2: Run to verify failure:**

```bash
bun test packages/shared/src/tools/concurrency.test.ts
```
Expected: FAIL on 7 tools (TodoWrite, Skill, Agent, Config, TaskCreate, TaskUpdate, TaskStop).

- [ ] **Step 2.3: Flip the 7 flags.** In each listed file change the `is_concurrency_safe:` line:
  - `TodoWrite/index.ts:29` → `is_concurrency_safe: true,` (pure UI side effect)
  - `Skill/index.ts:21` → `is_concurrency_safe: true,` (loads instructions only)
  - `Agent/index.ts:31` → `is_concurrency_safe: true,` (isolated sub-loop — this is what makes subagents parallel)
  - `Config/index.ts:17` → `is_concurrency_safe: false,` (writes settings; reads input-dependent → conservative)
  - `TaskCreate/index.ts:26` → `is_concurrency_safe: false,` (task-store write)
  - `TaskUpdate/index.ts:48` → `is_concurrency_safe: false,` (task-store write)
  - `TaskStop/index.ts:16` → `is_concurrency_safe: false,` (task-store write)

- [ ] **Step 2.4: Run tests:**

```bash
bun test packages/shared
```
Expected: PASS (including existing suites).

- [ ] **Step 2.5: Commit:**

```bash
git add packages/shared
git commit -m "fix(shared): align is_concurrency_safe flags with the scheduler table"
```

---

## Task 3: PostToolUse hooks return their `systemMessage` (TDD)

`runPostToolHooks` currently returns `void` and discards every hook output — the spec calls this out as the silently-dropped channel. Make it return `{ systemMessage?: string }`, aggregated by a small pure helper we can unit-test without spawning processes.

**Files:**
- Modify: `packages/cli/src/lib/hooks.ts`
- Test: `packages/cli/src/lib/hooks.test.ts` (create)

- [ ] **Step 3.1: Write the failing test** — `packages/cli/src/lib/hooks.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mergeSystemMessages } from "./hooks";

describe("mergeSystemMessages", () => {
  test("joins systemMessages from multiple hook outputs, skipping empties", () => {
    expect(
      mergeSystemMessages([
        { systemMessage: "first" },
        null,
        { decision: "approve" },
        { systemMessage: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  test("returns undefined when no hook produced a systemMessage", () => {
    expect(mergeSystemMessages([null, {}])).toBeUndefined();
  });
});
```

- [ ] **Step 3.2: Run to verify failure:**

```bash
bun test packages/cli/src/lib/hooks.test.ts
```
Expected: FAIL — `mergeSystemMessages` is not exported.

- [ ] **Step 3.3: Implement.** In `packages/cli/src/lib/hooks.ts`:

Add the helper (near the other public runners, above `runPostToolHooks`):

```ts
/** Aggregate the systemMessage channel across parallel hook outputs. */
export function mergeSystemMessages(
  outputs: Array<HookOutput | null>,
): string | undefined {
  const messages = outputs
    .map((o) => o?.systemMessage)
    .filter((m): m is string => typeof m === "string" && m.length > 0);
  return messages.length > 0 ? messages.join("\n") : undefined;
}
```

Change `runPostToolHooks` (currently `Promise<void>`, `lib/hooks.ts:306-323`) to:

```ts
export type PostToolHookResult = { systemMessage?: string };

export async function runPostToolHooks(
  toolName: string,
  input: unknown,
  response: unknown,
  sessionId: string,
): Promise<PostToolHookResult> {
  const config = loadHooks();
  const hooks = getMatchingHooks(config, "PostToolUse", toolName);
  const hookInput: PostToolUseInput = {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    cwd: process.cwd(),
    tool_name: toolName,
    tool_input: input,
    tool_response: response,
  };
  const outputs = await Promise.all(
    hooks.map((hook) => execHook(hook, hookInput)),
  );
  return { systemMessage: mergeSystemMessages(outputs) };
}
```

`runPostToolUseFailureHooks` stays `Promise<void>`. The existing `void runPostToolHooks(...)` call in `tools/index.ts:159` still compiles (result ignored — Task 4 leaves that legacy path for subagents).

- [ ] **Step 3.4: Run tests + typecheck:**

```bash
bun test packages/cli/src/lib/hooks.test.ts
cd packages/cli && bun run check-types && cd ../..
```
Expected: PASS / clean.

- [ ] **Step 3.5: Commit:**

```bash
git add packages/cli/src/lib/hooks.ts packages/cli/src/lib/hooks.test.ts
git commit -m "feat(cli): surface PostToolUse hook systemMessage to callers"
```

---

## Task 4: Export a hook-free executor from `tools/index.ts`

The scheduler owns hook invocation, so the engine path must execute tools *without* `executeLocalTool` re-running them. Rename the private impl and export it. `executeLocalTool` (hooks included) stays for the subagent path (`Agent/execute.ts:97-100`, `run-subagent.ts`).

**Files:**
- Modify: `packages/cli/src/lib/tools/index.ts`

- [ ] **Step 4.1:** In `packages/cli/src/lib/tools/index.ts` rename `executeLocalToolImpl` → exported `executeRegisteredTool` (same signature, add doc):

```ts
/**
 * Execute a registered tool WITHOUT running Pre/PostToolUse hooks — the
 * engine scheduler owns hook invocation. Throws on unknown tool, mode
 * mismatch, or executor failure. Use executeLocalTool when hooks should run
 * here (legacy subagent path).
 */
export async function executeRegisteredTool(
  toolName: string,
  input: unknown,
  mode: ModeType,
  sessionId: string,
  options: ExecuteLocalToolOptions = {},
): Promise<unknown> {
  const tool = getTool(toolName);
  if (!tool) {
    throw new Error(
      `Unknown tool: ${toolName}. Available tools: ${ALL_TOOL_NAMES.join(", ")}`,
    );
  }
  if (!isToolAvailableInMode(tool, mode)) {
    throw new Error(`Tool ${toolName} is not available in ${mode} mode`);
  }
  const executor = EXECUTORS[toolName];
  if (!executor) {
    throw new Error(`Tool ${toolName} has no executor registered`);
  }
  return executor(input, {
    executionRoot: options.cwd ?? process.cwd(),
    sessionId,
    requestToolPermission: options.requestToolPermission,
    modelOverride: options.modelOverride,
  });
}
```

Update `executeLocalTool` to call `executeRegisteredTool(toolName, input, mode, sId, options)` where it called `executeLocalToolImpl(...)` (note: the old impl's `options` param had no default — the new default `= {}` is strictly safer).

- [ ] **Step 4.2: Typecheck + existing tool tests:**

```bash
cd packages/cli && bun run check-types && cd ../..
bun test packages/cli/src/lib/tools
```
Expected: clean / PASS.

- [ ] **Step 4.3: Commit:**

```bash
git add packages/cli/src/lib/tools/index.ts
git commit -m "refactor(cli): expose hook-free executeRegisteredTool for the engine"
```

---

## Task 5: Engine types — `ToolHost`, `PermissionDecision`, `mode_change` event

Additive only (the old `runTool` stays until Task 7 removes it), so the tree compiles after this task.

**Files:**
- Modify: `packages/cli/src/lib/engine/events.ts`

- [ ] **Step 5.1:** Add to `packages/cli/src/lib/engine/events.ts` (and extend the existing unions):

```ts
/** UI's answer to a gated tool call. */
export type PermissionDecision =
  | {
      behavior: "allow";
      /** Persist the grant (bash allowlist / session-wide edit approval). */
      always?: boolean;
      /** Raw OpenRouter id override for Agent spawns (per-spawn model pick). */
      modelOverride?: string;
    }
  | { behavior: "deny"; feedback?: string };

/**
 * Everything the engine needs from its embedder to run tools. Supplied by
 * useQueryEngine (and later, recursively, by the Agent tool). The engine owns
 * gating, loop protection, hooks, and scheduling; the host owns execution and
 * user interaction.
 */
export type ToolHost = {
  /** Execute one already-approved tool call. Throws on failure. */
  executeTool: (
    toolCall: ToolCallRequest,
    mode: ModeType,
    opts: { modelOverride?: string },
  ) => Promise<unknown>;
  /** Show a permission prompt and await the user's decision. */
  canUseTool: (
    toolCall: ToolCallRequest,
    mode: ModeType,
  ) => Promise<PermissionDecision>;
  /** AskUserQuestion: prompt and return the tool output ({ answers }). */
  askQuestion: (toolCall: ToolCallRequest) => Promise<unknown>;
  /** Bash allowlist check (persisted permissions.json). */
  isCommandAllowed: (command: string) => boolean;
  /** Persist a bash pattern after an "always" grant. */
  onAlwaysAllowBash: (command: string) => void;
};
```

Extend `EngineEvent` with:

```ts
  /** A tool result carried a modeTransition; subsequent rounds use the new mode. */
  | { type: "mode_change"; mode: ModeType }
```

Extend `QueryParams` with (keep `runTool` for now — Task 7 deletes it):

```ts
  /** Tool execution + user-interaction callbacks (replaces runTool). */
  host?: ToolHost;
  /** Hook adapter (engine/hooks.ts). Defaults to no-op for tests. */
  hooks?: import("./hooks").EngineHooks;
  /** Session-scoped "always allow edits" flag, owned by the embedder so it
   *  survives across turns. Defaults to a per-query internal flag. */
  alwaysAllowEdits?: { get: () => boolean; set: (value: boolean) => void };
```

- [ ] **Step 5.2:** Typecheck will fail on the `./hooks` import until Task 6 creates it — create a placeholder now or do Task 6 first. **Do Task 6 first, then typecheck both together.** (No commit yet.)

---

## Task 6: `engine/hooks.ts` — hook adapter (TDD)

The engine stays session-agnostic (locked in Phase 1): hook runners are injected, closed over `sessionId` by the embedder.

**Files:**
- Create: `packages/cli/src/lib/engine/hooks.ts`
- Test: `packages/cli/src/lib/engine/hooks.test.ts`

- [ ] **Step 6.1: Write the failing test** — `packages/cli/src/lib/engine/hooks.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { NOOP_ENGINE_HOOKS } from "./hooks";

describe("NOOP_ENGINE_HOOKS", () => {
  test("pre never blocks, post returns no message, failure resolves", async () => {
    expect(await NOOP_ENGINE_HOOKS.preToolUse("Read", {})).toEqual({
      blocked: false,
    });
    expect(await NOOP_ENGINE_HOOKS.postToolUse("Read", {}, {})).toEqual({});
    await NOOP_ENGINE_HOOKS.postToolUseFailure("Read", {}, "boom");
  });
});
```

- [ ] **Step 6.2: Run to verify failure:**

```bash
bun test packages/cli/src/lib/engine/hooks.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement** `packages/cli/src/lib/engine/hooks.ts`:

```ts
import {
  runPostToolHooks,
  runPostToolUseFailureHooks,
  runPreToolHooks,
} from "../hooks";

export type EnginePreToolResult = {
  blocked: boolean;
  reason?: string;
  systemMessage?: string;
};

export type EnginePostToolResult = { systemMessage?: string };

/**
 * The engine's view of the user hook system. Injected (closed over sessionId
 * by the embedder) so the engine stays session-agnostic and unit-testable.
 */
export type EngineHooks = {
  preToolUse: (toolName: string, input: unknown) => Promise<EnginePreToolResult>;
  postToolUse: (
    toolName: string,
    input: unknown,
    output: unknown,
  ) => Promise<EnginePostToolResult>;
  postToolUseFailure: (
    toolName: string,
    input: unknown,
    error: string,
  ) => Promise<void>;
};

export const NOOP_ENGINE_HOOKS: EngineHooks = {
  preToolUse: async () => ({ blocked: false }),
  postToolUse: async () => ({}),
  postToolUseFailure: async () => {},
};

/** Production adapter over lib/hooks.ts, bound to a session. */
export function createEngineHooks(sessionId: string): EngineHooks {
  return {
    preToolUse: (toolName, input) => runPreToolHooks(toolName, input, sessionId),
    postToolUse: (toolName, input, output) =>
      runPostToolHooks(toolName, input, output, sessionId),
    postToolUseFailure: (toolName, input, error) =>
      runPostToolUseFailureHooks(toolName, input, error, sessionId),
  };
}
```

- [ ] **Step 6.4: Run tests + typecheck** (this also validates Task 5's `events.ts` additions):

```bash
bun test packages/cli/src/lib/engine/hooks.test.ts
cd packages/cli && bun run check-types && cd ../..
```
Expected: PASS / clean.

- [ ] **Step 6.5: Commit Tasks 5+6 together:**

```bash
git add packages/cli/src/lib/engine/events.ts packages/cli/src/lib/engine/hooks.ts packages/cli/src/lib/engine/hooks.test.ts
git commit -m "feat(cli): add engine ToolHost contract and hook adapter"
```

---

## Task 7: `engine/scheduler.ts` — the tool scheduler (TDD)

The heart of the phase. One pipeline per call; safe batches concurrent (cap 10) via an event channel; unsafe serial. Returns the turn's collected hook `systemMessage`s.

**Files:**
- Create: `packages/cli/src/lib/engine/scheduler.ts`
- Test: `packages/cli/src/lib/engine/scheduler.test.ts`

- [ ] **Step 7.1: Write the failing tests** — `packages/cli/src/lib/engine/scheduler.test.ts`:

```ts
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
      [tc("AskUserQuestion", { questions: [] }, "q1")],
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

  test("loop guard rejects the 9th identical call without executing", async () => {
    let executions = 0;
    const host = makeHost({
      executeTool: async () => {
        executions++;
        return {};
      },
    });
    const calls = Array.from({ length: 9 }, (_, i) =>
      tc("Grep", { pattern: "x" }, `g${i}`),
    );
    const { events } = await run(calls, host);
    expect(executions).toBe(8);
    const last = resultOf(events, "g8");
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
});
```

- [ ] **Step 7.2: Run to verify failure:**

```bash
bun test packages/cli/src/lib/engine/scheduler.test.ts
```
Expected: FAIL — `Cannot find module './scheduler'`.

- [ ] **Step 7.3: Implement** `packages/cli/src/lib/engine/scheduler.ts`:

```ts
import { getKnightcodeTool, type ModeType } from "@repo/shared";
import type {
  ToolCallRequest,
  ToolHost,
  ToolOutcome,
} from "./events";
import type { EngineHooks } from "./hooks";
import {
  gateToolCall,
  LOOP_PROTECTION_ERROR,
  ToolLoopGuard,
} from "./tool-runner";

/** Max concurrently executing tools inside one safe batch (claude-code: 10). */
const MAX_TOOL_CONCURRENCY = 10;

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export type SchedulerEvent =
  | { type: "tool_start"; toolCall: ToolCallRequest }
  | { type: "tool_result"; toolCallId: string; outcome: ToolOutcome };

export type SchedulerParams = {
  toolCalls: ToolCallRequest[];
  host: ToolHost;
  hooks: EngineHooks;
  /** Live mode lookup — EnterPlanMode/ExitPlanMode results change it mid-round. */
  getMode: () => ModeType;
  loopGuard: ToolLoopGuard;
  alwaysAllowEdits: { get: () => boolean; set: (value: boolean) => void };
  abortSignal?: AbortSignal;
};

export type ToolBatch = { safe: boolean; calls: ToolCallRequest[] };

/**
 * Partition a round's tool calls into batches: contiguous concurrency-safe
 * calls group together (run in parallel); every unsafe call is its own
 * serial batch. Unknown tools are conservatively unsafe.
 */
export function partitionToolCalls(calls: ToolCallRequest[]): ToolBatch[] {
  return calls.reduce<ToolBatch[]>((acc, call) => {
    const safe =
      getKnightcodeTool(call.toolName)?.is_concurrency_safe ?? false;
    const last = acc[acc.length - 1];
    if (safe && last?.safe) {
      last.calls.push(call);
    } else {
      acc.push({ safe, calls: [call] });
    }
    return acc;
  }, []);
}

/** Single-consumer event channel bridging parallel executors to the generator. */
function createChannel<T>() {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(item: T) {
      buffer.push(item);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
    async *drain(): AsyncGenerator<T, void> {
      while (true) {
        while (buffer.length > 0) yield buffer.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

// Handoff semaphore: release() transfers the slot directly to the next
// waiter (active stays constant) instead of decrementing and letting the
// waiter re-increment — a sync acquire arriving between those two microtasks
// could otherwise exceed the cap.
function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire() {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    },
    release() {
      const next = waiters.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    },
  };
}

/**
 * The full per-call pipeline. Every path returns a ToolOutcome — the
 * scheduler, not callers, guarantees tool_use/tool_result pairing.
 * Order: loop guard → zod parse → PreToolUse hooks (block beats prompt,
 * claude-code's order) → gate → canUseTool/askQuestion → execute → PostToolUse.
 */
async function executeOne(
  toolCall: ToolCallRequest,
  params: SchedulerParams,
  reminders: string[],
): Promise<ToolOutcome> {
  const { host, hooks } = params;
  const { toolName, input } = toolCall;

  if (!params.loopGuard.check(toolName, input)) {
    return { kind: "error", errorText: LOOP_PROTECTION_ERROR };
  }

  const contract = getKnightcodeTool(toolName);
  if (contract) {
    const parsed = contract.input_schema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
        .join("; ");
      return {
        kind: "error",
        errorText: `Invalid input for ${toolName}: ${issues}`,
      };
    }
  }

  let pre: Awaited<ReturnType<EngineHooks["preToolUse"]>>;
  try {
    pre = await hooks.preToolUse(toolName, input);
  } catch {
    pre = { blocked: false };
  }
  if (pre.systemMessage) reminders.push(pre.systemMessage);
  if (pre.blocked) {
    return {
      kind: "error",
      errorText: pre.reason
        ? `Hook blocked tool ${toolName}: ${pre.reason}`
        : `Hook blocked tool ${toolName}`,
    };
  }

  const mode = params.getMode();
  const decision = gateToolCall({
    toolName,
    input,
    mode,
    alwaysAllowEdits: params.alwaysAllowEdits.get(),
    isCommandAllowed: host.isCommandAllowed,
  });

  let modelOverride: string | undefined;
  if (decision === "confirm") {
    if (toolName === "AskUserQuestion") {
      const output = await host.askQuestion(toolCall);
      return { kind: "output", output };
    }
    const granted = await host.canUseTool(toolCall, mode);
    if (granted.behavior === "deny") {
      return {
        kind: "error",
        errorText: granted.feedback?.trim()
          ? `User declined this change. Guidance: ${granted.feedback.trim()}`
          : "User rejected the changes",
      };
    }
    if (granted.always) {
      if (toolName === "Bash") {
        const command = (input as { command?: string })?.command;
        if (typeof command === "string" && command.trim()) {
          host.onAlwaysAllowBash(command);
        }
      } else if (FILE_EDIT_TOOLS.has(toolName)) {
        params.alwaysAllowEdits.set(true);
      }
    }
    modelOverride = granted.modelOverride;
  }

  try {
    const output = await host.executeTool(toolCall, mode, { modelOverride });
    try {
      const post = await hooks.postToolUse(toolName, input, output);
      if (post.systemMessage) reminders.push(post.systemMessage);
    } catch {
      // post hooks must never fail the tool
    }
    return { kind: "output", output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await hooks.postToolUseFailure(toolName, input, message);
    } catch {
      // failure hooks must never mask the original error
    }
    return { kind: "error", errorText: message };
  }
}

/**
 * Run one round's tool calls: safe batches concurrent (cap 10), unsafe
 * serial, abort stops scheduling (in-flight calls run to completion).
 * Returns the hook systemMessages collected this round.
 */
export async function* runToolCalls(
  params: SchedulerParams,
): AsyncGenerator<SchedulerEvent, string[]> {
  const reminders: string[] = [];

  for (const batch of partitionToolCalls(params.toolCalls)) {
    if (params.abortSignal?.aborted) break;

    if (batch.safe && batch.calls.length > 1) {
      const channel = createChannel<SchedulerEvent>();
      const semaphore = createSemaphore(MAX_TOOL_CONCURRENCY);
      const work = Promise.all(
        batch.calls.map(async (toolCall) => {
          await semaphore.acquire();
          try {
            if (params.abortSignal?.aborted) return;
            channel.push({ type: "tool_start", toolCall });
            const outcome = await executeOne(toolCall, params, reminders);
            channel.push({
              type: "tool_result",
              toolCallId: toolCall.toolCallId,
              outcome,
            });
          } finally {
            semaphore.release();
          }
        }),
      );
      void work.then(
        () => channel.close(),
        () => channel.close(),
      );
      yield* channel.drain();
      await work;
    } else {
      for (const toolCall of batch.calls) {
        if (params.abortSignal?.aborted) break;
        yield { type: "tool_start", toolCall };
        if (params.abortSignal?.aborted) break; // consumer may abort on the event
        const outcome = await executeOne(toolCall, params, reminders);
        yield {
          type: "tool_result",
          toolCallId: toolCall.toolCallId,
          outcome,
        };
      }
    }
  }

  return reminders;
}
```

- [ ] **Step 7.4: Run tests:**

```bash
bun test packages/cli/src/lib/engine/scheduler.test.ts
```
Expected: PASS (14 tests). If the zod-parse test fails because `getKnightcodeTool("Grep").input_schema.safeParse({})` unexpectedly succeeds, check the Grep contract's schema — pick another tool with a required field (e.g. `Read` requires `file_path`) and adjust the test.

- [ ] **Step 7.5: Typecheck + commit:**

```bash
cd packages/cli && bun run check-types && cd ../..
git add packages/cli/src/lib/engine/scheduler.ts packages/cli/src/lib/engine/scheduler.test.ts
git commit -m "feat(cli): add concurrency-aware tool scheduler with engine-owned policy"
```

---

## Task 8: Integrate the scheduler into `engine/query.ts` (TDD)

Replace the serial `runTool` loop with the scheduler; add engine-tracked mode + `mode_change`; inject hook reminders next round; create the loop guard inside the engine. **Breaking param change:** `runTool` is deleted; `host` becomes required.

**Files:**
- Modify: `packages/cli/src/lib/engine/query.ts`
- Modify: `packages/cli/src/lib/engine/events.ts` (remove `runTool`, make `host` required)
- Modify: `packages/cli/src/lib/engine/query.test.ts`

- [ ] **Step 8.1: Update `events.ts`:** delete the `runTool` field from `QueryParams` (and its doc comment) and change `host?: ToolHost` → `host: ToolHost`. Keep `hooks?` and `alwaysAllowEdits?` optional.

- [ ] **Step 8.2: Rewrite the query tests.** In `query.test.ts`:

Replace the `baseParams` helper and every `runTool` usage with a host-based helper (the drain/userMsg/model helpers and `modelOverrideForTest` seam stay as they are):

```ts
import type { ToolHost } from "./events";
import { NOOP_ENGINE_HOOKS } from "./hooks";

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
  modelOverrideForTest: model,
});
```

Existing test updates:
- "tool round" test: `makeHost(async (tc) => { calls.push(tc.toolName); return { content: "hi" }; })` — note `executeTool` returns the output directly (no `{kind:"output"}` wrapper) and signals failure by throwing.
- "runTool error" test becomes "executeTool throw becomes output-error part": `makeHost(async () => { throw new Error("boom"); })`.
- Abort test: host whose `executeTool` throws `"should not run"`, abort on the `tool_call` event — unchanged expectations.

Add two new tests:

```ts
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
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ]),
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
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ]),
        };
      },
    });
    const host = makeHost(async () => ({ modeTransition: "BUILD" }));
    const params = { ...baseParams(model, host), mode: "PLAN" as const };
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
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
            ]),
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
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ]),
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
```

- [ ] **Step 8.3: Run to verify failure:**

```bash
bun test packages/cli/src/lib/engine/query.test.ts
```
Expected: FAIL (query still expects `runTool`).

- [ ] **Step 8.4: Rewrite `query.ts`.** Changes, in order:

Imports: drop nothing yet; add:

```ts
import type { ModeType } from "@repo/shared";
import { NOOP_ENGINE_HOOKS } from "./hooks";
import { runToolCalls } from "./scheduler";
import { ToolLoopGuard } from "./tool-runner";
```

Top of `query()` — replace the destructure (drop `mode` const and `runTool`):

```ts
  const { cwd, modelId, reasoningEffort, host, abortSignal } = params;
  const hooks = params.hooks ?? NOOP_ENGINE_HOOKS;
  const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const turnStartMs = params.turnStartMs ?? Date.now();

  // Engine State (spec): current mode (modeTransition results update it),
  // loop guard (per turn), session-scoped edit grant (embedder-owned), and
  // hook reminders pending injection into the next round.
  let mode: ModeType = params.mode;
  const loopGuard = new ToolLoopGuard();
  let internalAlwaysAllowEdits = false;
  const alwaysAllowEdits = params.alwaysAllowEdits ?? {
    get: () => internalAlwaysAllowEdits,
    set: (value: boolean) => {
      internalAlwaysAllowEdits = value;
    },
  };
  const reminders: string[] = [];
```

The `assistant` message metadata keeps `{ mode: params.mode, model: modelId }` (the mode the user submitted in).

Inside the round loop, the contract/deferred lines already read `mode` — they now pick up the live value each round (no code change needed beyond the `let`). After the `availableDeferredTools` computation, build the request with reminder injection — replace the current `requestMessages` assignment:

```ts
      // Hook systemMessages accumulated this turn ride along as a transient
      // user message (request-view only — never persisted to the transcript).
      // Placed AFTER the assistant message so the model sees them following
      // the tool calls/results that produced them — claude-code appends
      // attachments to toolResults the same way (query.ts:1580-1590,
      // `toolResults.push(attachment)`).
      const reminderMessage: Message | null =
        reminders.length === 0
          ? null
          : ({
              id: "engine-hook-reminders",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: `<system-reminder>\n${reminders.join("\n\n")}\n</system-reminder>`,
                },
              ],
            } as Message);
      const requestMessages = [
        ...transcript,
        ...(assistant.parts.length > 0 ? [assistant] : []),
        ...(reminderMessage ? [reminderMessage] : []),
      ];
```

Replace the entire `for (const toolCall of toolCalls) { ... }` execution loop (currently `query.ts:282-310`) with scheduler consumption:

```ts
      const scheduler = runToolCalls({
        toolCalls,
        host,
        hooks,
        getMode: () => mode,
        loopGuard,
        alwaysAllowEdits,
        abortSignal,
      });
      while (true) {
        const step = await scheduler.next();
        if (step.done) {
          reminders.push(...step.value);
          break;
        }
        const ev = step.value;
        if (ev.type === "tool_start") {
          yield { type: "tool_call", toolCall: ev.toolCall };
          continue;
        }
        const toolPart = assistant.parts.find(
          (p) => (p as never as ToolPart).toolCallId === ev.toolCallId,
        ) as never as ToolPart | undefined;
        if (toolPart) {
          if (ev.outcome.kind === "output") {
            toolPart.state = "output-available";
            toolPart.output = ev.outcome.output;
          } else {
            toolPart.state = "output-error";
            toolPart.errorText = ev.outcome.errorText;
          }
        }
        if (toolPart) {
          const found = toolCalls.find((c) => c.toolCallId === ev.toolCallId);
          if (found) trackToolSearchLoads(found, ev.outcome, loadedDeferred);
        }
        // Mode transitions (EnterPlanMode/ExitPlanMode) update engine State so
        // later rounds gate and assemble tools under the new mode.
        if (
          ev.outcome.kind === "output" &&
          ev.outcome.output &&
          typeof ev.outcome.output === "object" &&
          "modeTransition" in ev.outcome.output
        ) {
          mode = (ev.outcome.output as { modeTransition: ModeType })
            .modeTransition;
          yield { type: "mode_change", mode };
        }
        yield { type: "tool_result", toolCallId: ev.toolCallId, outcome: ev.outcome };
        yield { type: "message_update", message: snapshot(assistant) };
      }
```

(The post-loop `if (abortSignal?.aborted)` sealTurn block stays as-is.)

- [ ] **Step 8.5: Run the engine suite; fix `MockLanguageModelV3` option shapes if the prompt-capture test needs adjusting** (the `doStream` options carry `prompt` — verify the field name against `ai/test` types in `node_modules/ai/dist`):

```bash
bun test packages/cli/src/lib/engine
```
Expected: PASS (query 6, scheduler 14, transcript 4, tool-runner 9, hooks 1).

- [ ] **Step 8.6: Typecheck** — expect ONE remaining error in `hooks/use-query-engine.ts` (still passing `runTool`). That's Task 10; do not commit broken. **Proceed to Task 10 before committing if you want green commits — or do the minimal hook change now as part of this commit.** Recommended: continue to Task 10 and commit Tasks 8+10 separately only when each compiles. To keep this commit green, apply Task 10's hook rewrite first, then:

```bash
cd packages/cli && bun run check-types && cd ../..
bun test packages/cli
git add packages/cli/src/lib/engine packages/cli/src/hooks/use-query-engine.ts
git commit -m "feat(cli): run engine tool rounds through the scheduler with engine-owned policy"
```

(Single commit covering engine integration + hook host swap is acceptable; they are one breaking change.)

---

## Task 9: `useQueryEngine` — host swap + running-tool tracking

Replace `makeRunTool` with a `ToolHost`; wire `mode_change` and running-tool IDs; delete hook-side gating/loop-guard.

**Files:**
- Modify: `packages/cli/src/hooks/use-query-engine.ts`

- [ ] **Step 9.1: Imports.** Remove `gateToolCall`, `LOOP_PROTECTION_ERROR`, `ToolLoopGuard`, `executeLocalTool` imports. Add:

```ts
import type { PermissionDecision, ToolHost } from "../lib/engine/events";
import { createEngineHooks } from "../lib/engine/hooks";
import { executeRegisteredTool } from "../lib/tools";
```

Keep `allowCommand, isCommandAllowed` (now host callbacks).

- [ ] **Step 9.2: State.** Delete `loopGuardRef` (and its `reset()` call in `submit`). Keep `alwaysAllowEditsRef`. Add:

```ts
  // toolCallIds currently executing (engine tool_call → tool_result window);
  // drives the per-row spinners for concurrent tools.
  const [runningToolIds, setRunningToolIds] = useState<Set<string>>(
    () => new Set(),
  );
```

- [ ] **Step 9.3: Replace `makeRunTool` with `makeHost`** (delete the whole `makeRunTool` callback, `use-query-engine.ts:219-328`):

```ts
  const engineHooks = useMemo(() => createEngineHooks(sessionId), [sessionId]);

  /** Engine ToolHost: execution + user interaction. Gating/loop-guard/hooks
   *  now live in the engine scheduler. */
  const makeHost = useCallback(
    (): ToolHost => ({
      executeTool: async (toolCall, mode, opts) => {
        // TodoWrite is a pure UI side effect — feed the panel, skip executors.
        if (toolCall.toolName === "TodoWrite") {
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
          return { success: true, itemCount: items.length };
        }
        return executeRegisteredTool(
          toolCall.toolName,
          toolCall.input,
          mode,
          sessionId,
          {
            modelOverride: opts.modelOverride,
            requestToolPermission: (tc) => requestToolPermission(tc, mode),
          },
        );
      },
      canUseTool: async (toolCall, mode): Promise<PermissionDecision> => {
        const d = await requestConfirmation(toolCall, mode);
        return d.allowed
          ? {
              behavior: "allow",
              always: d.always,
              modelOverride: d.modelOverride,
            }
          : { behavior: "deny", feedback: d.feedback };
      },
      askQuestion: (toolCall) =>
        new Promise<unknown>((resolve) => {
          questionResolversRef.current.set(
            toolCall.toolCallId,
            resolve as (answers: { answers: unknown }) => void,
          );
          setPendingConfirmations((prev) => [
            ...prev,
            { toolCallId: toolCall.toolCallId, toolCall, mode: "BUILD" },
          ]);
        }),
      isCommandAllowed,
      onAlwaysAllowBash: (command) => allowCommand(command),
    }),
    [sessionId, requestConfirmation, requestToolPermission],
  );
```

Note: the old AskUserQuestion branch passed the live `mode` into the pending entry; the question UI doesn't use it (only `InlineQuestion` renders). If you want exact parity, change `askQuestion`'s signature usage to capture mode from the submit params closure instead — simplest is to leave `"BUILD"` and note it, since `PendingConfirmation.mode` is only consumed by permission dialogs, not questions. **Check `screens/session.tsx` + `inline-question.tsx` before deviating** — as read today, `mode` is unused for questions.

The old `if (d.always) { allowCommand / alwaysAllowEditsRef }` block is gone from the hook — the engine applies grants via `onAlwaysAllowBash` / the `alwaysAllowEdits` accessor.

- [ ] **Step 9.3b: Delete the multi-pending edit auto-approve loop in `confirmToolCall`** (the `if (allowed && always && pending && FILE_EDIT_TOOLS.has(...))` block that iterates `pendingConfirmationsRef` and resolves other file-edit confirmations, plus the now-unused `FILE_EDIT_TOOLS` set at the top of the hook if nothing else references it). It is dead code under the scheduler: file-edit tools are concurrency-unsafe so they serialize — two file-edit `confirmResolversRef` entries can never be pending simultaneously — and once the engine's `alwaysAllowEdits` flag is set by the first grant, subsequent edits skip the prompt entirely (covered by the Task 7 "alwaysAllowEdits=true skips the prompt" test). Subagent-bubbled edit permissions go through `permissionResolversRef`, which this loop never touched.

- [ ] **Step 9.4: `submit` — engine call + event handling.** Replace the `query({ ... runTool: makeRunTool(params.mode) ... })` params with:

```ts
        const gen = query({
          cwd: process.cwd(),
          messages: base,
          mode: params.mode,
          modelId: params.model,
          reasoningEffort: params.reasoningEffort,
          getApiKey: getOpenRouterApiKey,
          host: makeHost(),
          hooks: engineHooks,
          alwaysAllowEdits: {
            get: () => alwaysAllowEditsRef.current,
            set: (v) => {
              alwaysAllowEditsRef.current = v;
            },
          },
          abortSignal: ac.signal,
          turnStartMs: submittedAt,
          getTurnPausedMs,
        });
```

In the event `switch`, add cases:

```ts
              case "tool_call":
                setRunningToolIds((prev) => {
                  const next = new Set(prev);
                  next.add(event.toolCall.toolCallId);
                  return next;
                });
                break;
              case "tool_result":
                setRunningToolIds((prev) => {
                  const next = new Set(prev);
                  next.delete(event.toolCallId);
                  return next;
                });
                break;
              case "mode_change":
                options?.onModeChange?.(event.mode);
                break;
```

Add `options?.onModeChange` to the `submit` dependency array (it was a dep of the deleted `makeRunTool`; `makeHost` no longer needs it). In the inner `finally` (where pending confirmations are cleared), add:

```ts
          setRunningToolIds(new Set());
```

Also delete the now-dead `loopGuardRef.current.reset();` line in `submit`.

- [ ] **Step 9.5: Return surface.** Add `runningToolIds,` to the returned object.

- [ ] **Step 9.6: Typecheck + full CLI tests:**

```bash
cd packages/cli && bun run check-types && cd ../..
bun test packages/cli
```
Expected: clean / PASS. (This step plus Task 8 form the single green commit shown in Step 8.6 if you deferred it.)

---

## Task 10: `/undo` preservation through the scheduler (integration test)

Spec §Error handling: "the session-snapshot recording (`recordOriginalContent`) that powers `/undo` is preserved — verified as a Phase 2 test, not left implicit." Run a real Edit through the scheduler pipeline with the real executor, then undo.

**Files:**
- Test: `packages/cli/src/lib/engine/scheduler-undo.test.ts` (create)

- [ ] **Step 10.1: Write the test:**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolCallRequest, ToolHost } from "./events";
import { NOOP_ENGINE_HOOKS } from "./hooks";
import { ToolLoopGuard } from "./tool-runner";
import { runToolCalls } from "./scheduler";
import { executeRegisteredTool, undoSessionChanges } from "../tools";

describe("scheduler preserves /undo snapshots", () => {
  test("Edit via the scheduler records original content; undo restores it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-undo-"));
    const file = join(dir, "target.txt");
    writeFileSync(file, "original content\n", "utf-8");
    const sessionId = `undo-test-${Date.now()}`;

    const host: ToolHost = {
      executeTool: (toolCall, mode, opts) =>
        executeRegisteredTool(toolCall.toolName, toolCall.input, mode, sessionId, {
          cwd: dir,
          modelOverride: opts.modelOverride,
        }),
      canUseTool: async () => ({ behavior: "allow" }),
      askQuestion: async () => ({ answers: [] }),
      isCommandAllowed: () => false,
      onAlwaysAllowBash: () => {},
    };

    const toolCalls: ToolCallRequest[] = [
      {
        toolCallId: "e1",
        toolName: "Edit",
        input: {
          file_path: file,
          old_string: "original content",
          new_string: "edited content",
        },
      },
    ];

    let allow = false;
    const gen = runToolCalls({
      toolCalls,
      host,
      hooks: NOOP_ENGINE_HOOKS,
      getMode: () => "BUILD",
      loopGuard: new ToolLoopGuard(),
      alwaysAllowEdits: { get: () => allow, set: (v) => (allow = v) },
    });
    while (!(await gen.next()).done) {
      // drain
    }

    expect(readFileSync(file, "utf-8")).toContain("edited content");
    const { revertedFiles, failedFiles } = await undoSessionChanges(sessionId);
    expect(failedFiles).toEqual([]);
    expect(revertedFiles.length).toBe(1);
    expect(readFileSync(file, "utf-8")).toBe("original content\n");
  });
});
```

- [ ] **Step 10.2: Run it.** If the Edit executor rejects paths outside the execution root or requires a prior Read, adapt the input (check `packages/cli/src/lib/tools/Edit/execute.ts` for its guards — e.g. it may require `cwd`-relative paths or a read-before-edit; pass `cwd: dir` as shown and use whatever shape the executor's own tests use):

```bash
bun test packages/cli/src/lib/engine/scheduler-undo.test.ts
```
Expected: PASS.

- [ ] **Step 10.3: Commit:**

```bash
git add packages/cli/src/lib/engine/scheduler-undo.test.ts
git commit -m "test(cli): verify /undo snapshots survive scheduler-driven edits"
```

---

## Task 11: UI lockstep — concurrent tool rows with spinners

Running tools (engine `tool_call` → `tool_result` window) get an animated spinner glyph; queued/pending rows keep the static dim bullet. Parallel Agent rows fall out of this for free (Agent is now concurrency-safe → multiple rows running at once).

**Files:**
- Modify: `packages/cli/src/components/messages/tool-call-view.tsx`
- Modify: `packages/cli/src/components/messages/bot-message.tsx`
- Modify: `packages/cli/src/components/messages/interrupted-message.tsx` (passes parts to the same renderer — check whether it renders `ToolCallView` directly; if it only reuses `BotMessage` internals, thread the prop the same way; if it never shows running tools, skip it)
- Modify: `packages/cli/src/screens/session.tsx`

- [ ] **Step 11.1: `ToolCallView` — `running` prop.** In `tool-call-view.tsx`:

```tsx
import { useSpinnerFrame } from "../../lib/ui/spinner-frame";
```

Add to `Props`:

```ts
  /** True while the engine is executing this call — animates the bullet. */
  running?: boolean;
```

In the component body (after `const status = toolStatus({ state });`):

```tsx
  const spinnerFrame = useSpinnerFrame(running ? 120 : 0);
  const isRunning = running && status === "running";
```

Replace the bullet text node:

```tsx
        <text fg={isRunning ? colors.primary : bulletColor}>
          {isRunning ? spinnerFrame : BULLET}{" "}
        </text>
```

(`useSpinnerFrame(0)` installs no interval — `spinner-frame.ts:19` guards `intervalMs <= 0` — so idle rows don't tick.)

- [ ] **Step 11.2: `BotMessage` — thread the set.** In `bot-message.tsx` add to `Props`:

```ts
  /** toolCallIds currently executing (drives per-row spinners). */
  runningToolIds?: Set<string>;
```

Destructure `runningToolIds` in the component and pass to the final `ToolCallView` (the generic fallback at the bottom of the tool-part branch):

```tsx
              return (
                <ToolCallView
                  key={part.toolCallId}
                  toolName={toolName}
                  input={part.input}
                  state={part.state}
                  output={part.output}
                  running={runningToolIds?.has(part.toolCallId) ?? false}
                  errorText={
                    part.state === "output-error" ? part.errorText : undefined
                  }
                />
              );
```

- [ ] **Step 11.3: `session.tsx` — plumb from the hook.** In `SessionChat`, destructure `runningToolIds` from `useQueryEngine(...)`. Add `runningToolIds?: Set<string>` to `ChatMessage`'s props and `<BotMessage ... runningToolIds={runningToolIds} />`; pass `runningToolIds={runningToolIds}` at the `ChatMessage` call site (around `session.tsx:398-406`, only the streaming message needs it, but passing to all is harmless — pass to all for simplicity). Also pass it through the memoized message-list wrapper at `session.tsx:96` if that's the actual render path (both `ChatMessage` usages get the prop).

- [ ] **Step 11.4: Typecheck + full suite:**

```bash
cd packages/cli && bun run check-types && cd ../..
bun test packages/cli && bun test packages/shared
```
Expected: clean / PASS.

- [ ] **Step 11.5: Commit:**

```bash
git add packages/cli/src/components packages/cli/src/screens/session.tsx packages/cli/src/hooks/use-query-engine.ts
git commit -m "feat(cli): per-row spinners for concurrently running tools"
```

---

## Task 12: Manual smoke + final verification

- [ ] **Step 12.1: Full gates from repo root:**

```bash
cd packages/cli && bun run check-types && cd ../..
bun test
```
Expected: all green (CLI ~300+, shared suites).

- [ ] **Step 12.2: Manual smoke (real TUI, real OpenRouter key).** Run `bun --cwd packages/cli run dev` (or the repo's dev script — check `packages/cli/package.json`) in a scratch directory and verify:
  1. Ask: *"Read package.json, README.md and bun.lock at the same time and summarize each."* → three Read rows appear together with spinners, results fill in independently.
  2. In BUILD mode ask for a file edit → permission prompt appears; choose "always" → a second edit in the same session skips the prompt.
  3. Deny an edit with feedback text → the model receives the guidance (visible in its next reply).
  4. `/plan` → ask it to exit plan mode → ExitPlanMode result switches the status bar to BUILD mid-turn (mode_change wiring).
  5. Add a PostToolUse hook via settings that echoes `{"systemMessage":"hook ran"}` and confirm the model references it on the round after a tool call (optional, needs a configured hook).
  6. Press Esc mid-tool-round → turn ends with interrupted marker, no "tool results missing" on the next message.

- [ ] **Step 12.3: Done.** Hand back to the user to open the PR from `engine-scheduler` (CodeRabbit + Codex review per workflow). Do not commit docs/superpowers content.

---

## Self-review notes (already applied)

- **Spec coverage:** scheduler+table (T2,T7), canUseTool+injected policy incl. AUTO short-circuit/Config split/always-allow/Bash allowlist (T7 — `gateToolCall` reused verbatim from Phase 1), engine/hooks.ts + PostToolUse systemMessage fix (T3,T6,T7,T8), loop protection in engine State (T8), mode_change State tracking (T8), every-path-yields-a-result owned by scheduler (T7), /undo preservation test (T10), UI lockstep spinners/permission-prompts/parallel-agent rows (T9,T11). Spec's `permission_request`/`question_request` events intentionally replaced by callbacks (locked decision 7); claude-code's updatedInput/ask-rules/streaming-executor are LATER per the comparison doc.
- **Type consistency:** `ToolHost`/`PermissionDecision` defined once in `events.ts` (T5), consumed by scheduler (T7), query (T8), hook (T9). `SchedulerEvent.tool_start` maps to engine `tool_call`. `EngineHooks` defined in `engine/hooks.ts` (T6).
- **Known judgment calls an executor may hit:** exact zod behavior of `Grep` schema in T7's invalid-input test (fallback tool suggested); `ai/test` `doStream` options field name in T8's prompt-capture test; Edit executor path guards in T10 (adapt to its own test conventions); `interrupted-message.tsx` prop threading in T11 (conditional).
