# OpenRouter Inference Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit policy for THIS plan (user override):** Do **NOT** commit per task. Keep the standard TDD red→green loop, but make **ONE commit at the very end** (Task 12) covering the whole phase. The user opens the PR.

**Goal:** Replace the hosted-server inference path with direct OpenRouter streaming, so the main chat loop, compaction, and the subagent step all run locally via the user's BYOK key — output quality becomes a pure function of the chosen model.

**Architecture:** A custom `LocalChatTransport` implements the AI SDK `ChatTransport` and calls `streamText(...).toUIMessageStream()` against `@openrouter/ai-sdk-provider`, preserving `useChat`'s tool-loop state machine. The system prompt + tool assembly that the server route did move into the CLI. Compaction and the subagent `callStep` become local inference calls through the same `resolveModel`. The local `bun:sqlite` store (built in `local-store`) is finally wired in for the active conversation's load/persist; the sessions-list/stats/doctor/rename dialogs stay on `apiClient` until `strip-server`.

**Tech Stack:** Bun, `ai` v6 (`streamText`, `generateText`, `toUIMessageStream`, `convertToModelMessages`, `validateUIMessages`, `ChatTransport`), `@openrouter/ai-sdk-provider` (`createOpenRouter`), Drizzle over `bun:sqlite`, `@ai-sdk/react` `useChat`, `bun:test`.

**Phase boundary (do NOT cross):** The server package stays present and compiling. Do not delete `packages/server`, `lib/api-client.ts`, OAuth, or repoint the sessions-list / stats / doctor / rename dialogs — that is `strip-server`. This phase repoints only the **main chat path**: transport, compaction, subagent step, and the active session's create/load/persist.

---

## File map

**New — `packages/shared/src/`:**

- `models.ts` (modify) — add `MODEL_SHORTLIST` + `ModelShortlistEntry`; export via `index.ts`.

**New — `packages/cli/src/lib/inference/`:**

- `resolve-model.ts` — model resolver (test already present: `resolve-model.test.ts`).
- `system-prompt.ts` — verbatim port of the server's `buildSystemPrompt`.
- `system-prompt.test.ts` — smoke test.
- `loaded-deferred-tools.ts` — verbatim port of server `extractLoadedDeferredTools`.
- `loaded-deferred-tools.test.ts` — port of server test.
- `build-request-context.ts` — gathers per-turn project/git/stack/skills/rules/agents context (extracted from `use-chat`'s old `prepareSendMessagesRequest`).
- `build-request-context.test.ts` — shape smoke test.
- `compact-conversation.ts` — local compaction with an injectable summarizer.
- `compact-conversation.test.ts` — assembly/preserve logic test with a stub.
- `local-chat-transport.ts` — the `ChatTransport` implementation.

**Modify — `packages/cli/src/lib/store/`:**

- `client.ts` — add `getStore()` lazy singleton.
- `conversation.ts` (new) — `rowToUIMessage`, `loadConversation`, `ensureSession`, `replaceSessionMessages`.
- `conversation.test.ts` (new).
- `index.ts` — export `conversation`.

**Modify — `packages/cli/src/`:**

- `hooks/use-chat.ts` — swap transport; swap compaction; swap the 3 `apiClient.sessions[":id"].$patch` calls for `replaceSessionMessages`.
- `lib/tools/Agent/execute.ts` — swap `callStep` from `apiClient["agent-step"]` to local `generateText`.
- `screens/session.tsx` — load the active session from the local store.
- `screens/new-session.tsx` — create the session in the local store.

---

## Task 1: Curated model shortlist in `@knightcode/shared`

**Files:**

- Modify: `packages/shared/src/models.ts` (append after `DEFAULT_CHAT_MODEL_ID`)
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/models.shortlist.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/models.shortlist.test.ts
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  MODEL_SHORTLIST,
} from "./index";

describe("MODEL_SHORTLIST", () => {
  test("is non-empty and every id resolves to a supported model", () => {
    expect(MODEL_SHORTLIST.length).toBeGreaterThan(0);
    for (const entry of MODEL_SHORTLIST) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(findSupportedChatModel(entry.id)).toBeDefined();
    }
  });

  test("includes the default model so onboarding can preselect it", () => {
    expect(MODEL_SHORTLIST.some((m) => m.id === DEFAULT_CHAT_MODEL_ID)).toBe(
      true,
    );
  });

  test("has unique ids", () => {
    const ids = MODEL_SHORTLIST.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`MODEL_SHORTLIST` not exported)

Run: `bun --cwd packages/shared test src/models.shortlist.test.ts`
Expected: FAIL ("MODEL_SHORTLIST" undefined / import error).

- [ ] **Step 3: Implement — append to `packages/shared/src/models.ts`**

```ts
export type ModelShortlistEntry = {
  id: SupportedChatModelId;
  label: string;
};

/**
 * Curated picker list spanning free → frontier strong tool-callers. Every id is
 * a SUPPORTED_CHAT_MODELS id (so it resolves), and all are OpenRouter-routable.
 * Used by onboarding and the in-app model switcher; a free-form override (any
 * OpenRouter id) is always accepted in addition to this list.
 */
export const MODEL_SHORTLIST: readonly ModelShortlistEntry[] = [
  { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air (free)" },
  { id: "deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash (free)" },
  { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B (free)" },
  { id: "z-ai/glm-5.1", label: "GLM 5.1" },
  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
  { id: "minimax/minimax-m2.7", label: "MiniMax M2.7" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
] as const;
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts`** — add to the existing `./models` re-export block:

```ts
export {
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  MODEL_SHORTLIST,
  SUPPORTED_CHAT_MODELS,
  type ModelPricing,
  type ModelShortlistEntry,
  type ReasoningEffortLevel,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
} from "./models";
```

- [ ] **Step 5: Run it — expect PASS**

Run: `bun --cwd packages/shared test src/models.shortlist.test.ts`
Expected: PASS.

---

## Task 2: `resolveModel` (test already present)

**Files:**

- Create: `packages/cli/src/lib/inference/resolve-model.ts`
- Test (exists): `packages/cli/src/lib/inference/resolve-model.test.ts`

- [ ] **Step 1: Run the existing test — expect FAIL** (impl missing)

Run: `bun --cwd packages/cli test src/lib/inference/resolve-model.test.ts`
Expected: FAIL (cannot import `./resolve-model`).

- [ ] **Step 2: Implement `resolve-model.ts`**

Key facts this satisfies: everything routes through OpenRouter now, so reasoning options always take the OpenRouter shape `{ openrouter: { reasoning: { effort } } }`; `max → xhigh`; default `medium`. Known non-thinking models (`supportsThinking` unset) get **no** reasoning options; unknown free-form ids get reasoning options (let OpenRouter decide). Bare anthropic/openai ids get namespaced; already-slashed ids pass through.

```ts
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  findSupportedChatModel,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { getOpenRouterApiKey } from "../credentials";

/** OpenRouter's reasoning enum has no "max"; map it to "xhigh". */
function toOpenRouterEffort(effort: ReasoningEffortLevel) {
  return effort === "max" ? "xhigh" : effort;
}

export function buildOpenRouterReasoningOptions(
  effort: ReasoningEffortLevel = "medium",
): ProviderOptions {
  return { openrouter: { reasoning: { effort: toOpenRouterEffort(effort) } } };
}

/**
 * Map a model id to its OpenRouter-canonical form. SUPPORTED_CHAT_MODELS keys
 * are bare for anthropic/openai ("claude-sonnet-4-6", "gpt-5.4") and slashed
 * for native OpenRouter ids ("z-ai/glm-4.5-air:free"). On OpenRouter the former
 * need a vendor prefix; the latter and any already-slashed free-form id pass
 * through untouched.
 */
export function toOpenRouterModelId(modelId: string): string {
  if (modelId.includes("/")) return modelId;
  const def = findSupportedChatModel(modelId);
  if (def?.provider === "anthropic") return `anthropic/${modelId}`;
  if (def?.provider === "openai") return `openai/${modelId}`;
  return modelId;
}

export type ResolvedModel = {
  model: LanguageModel;
  modelId: string;
  providerOptions?: ProviderOptions;
};

export type ResolveModelOptions = {
  /** Explicit key (tests). */
  apiKey?: string;
  /** Lazy key lookup; defaults to credentials/env. */
  getApiKey?: () => string | undefined;
};

export function resolveModel(
  modelId: string,
  reasoningEffort: ReasoningEffortLevel = "medium",
  options: ResolveModelOptions = {},
): ResolvedModel {
  const apiKey = options.apiKey ?? (options.getApiKey ?? getOpenRouterApiKey)();
  if (!apiKey) {
    throw new Error(
      "No OpenRouter API key found. Set OPENROUTER_API_KEY or run onboarding to store one in ~/.knightcode/credentials.json.",
    );
  }

  const openrouter = createOpenRouter({
    apiKey,
    headers: {
      "HTTP-Referer": "https://github.com/KnightCodeAI/knightcode",
      "X-Title": "KnightCode CLI",
    },
  });

  const canonicalId = toOpenRouterModelId(modelId);
  const def = findSupportedChatModel(modelId);
  // Known + non-thinking → omit reasoning. Known + thinking, or unknown
  // free-form → include it (unknown ids let OpenRouter decide).
  const includeReasoning = def ? def.supportsThinking === true : true;

  return {
    model: openrouter.chat(canonicalId),
    modelId: canonicalId,
    providerOptions: includeReasoning
      ? buildOpenRouterReasoningOptions(reasoningEffort)
      : undefined,
  };
}
```

- [ ] **Step 3: Run the test — expect PASS**

Run: `bun --cwd packages/cli test src/lib/inference/resolve-model.test.ts`
Expected: PASS (all `buildOpenRouterReasoningOptions`, `toOpenRouterModelId`, `resolveModel` cases).

> Note: `resolve-model.test.ts` line 71 asserts `resolved.modelId === "z-ai/glm-4.5-air:free"` (already slashed → unchanged) and line 79 `"openai/gpt-5.4-nano"` (bare openai → namespaced). The impl above produces exactly these.

---

## Task 3: Port `loaded-deferred-tools` into the CLI

**Files:**

- Create: `packages/cli/src/lib/inference/loaded-deferred-tools.ts`
- Test: `packages/cli/src/lib/inference/loaded-deferred-tools.test.ts`

- [ ] **Step 1: Write the failing test** (port of the server's behavior)

```ts
// packages/cli/src/lib/inference/loaded-deferred-tools.test.ts
import { describe, expect, test } from "bun:test";
import { extractLoadedDeferredTools } from "./loaded-deferred-tools";

describe("extractLoadedDeferredTools", () => {
  test("collects names from a successful ToolSearch output (typed part)", () => {
    const loaded = extractLoadedDeferredTools([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: "tool-ToolSearch",
            state: "output-available",
            output: { matches: [{ name: "WebSearch" }, { name: "WebFetch" }] },
          },
        ],
      } as any,
    ]);
    expect(loaded).toEqual(new Set(["WebSearch", "WebFetch"]));
  });

  test("collects from a dynamic-tool ToolSearch part", () => {
    const loaded = extractLoadedDeferredTools([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "ToolSearch",
            state: "output-available",
            output: { matches: [{ name: "NotebookEdit" }] },
          },
        ],
      } as any,
    ]);
    expect(loaded).toEqual(new Set(["NotebookEdit"]));
  });

  test("ignores non-output-available ToolSearch parts and other tools", () => {
    const loaded = extractLoadedDeferredTools([
      {
        id: "a",
        role: "assistant",
        parts: [
          { type: "tool-ToolSearch", state: "input-available" },
          {
            type: "tool-Read",
            state: "output-available",
            output: { matches: [{ name: "Nope" }] },
          },
        ],
      } as any,
    ]);
    expect(loaded.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bun --cwd packages/cli test src/lib/inference/loaded-deferred-tools.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `loaded-deferred-tools.ts`** — verbatim copy of `packages/server/src/lib/loaded-deferred-tools.ts` (only the file location changes; no server deps):

```ts
import type { UIMessage } from "ai";

type ToolSearchMatch = { name?: unknown };
type ToolSearchOutput = { matches?: unknown };

function isToolSearchPart(part: { type?: string; toolName?: string }): boolean {
  if (part.type === "tool-ToolSearch") return true;
  if (part.type === "dynamic-tool" && part.toolName === "ToolSearch") {
    return true;
  }
  return false;
}

/**
 * Scan the message history for prior successful ToolSearch outputs and return
 * the union of tool names the model has discovered. Once loaded in a
 * conversation, a deferred tool stays loaded for subsequent turns.
 */
export function extractLoadedDeferredTools(
  messages: ReadonlyArray<UIMessage<any, any, any>>,
): Set<string> {
  const loaded = new Set<string>();
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as {
        type?: string;
        toolName?: string;
        state?: string;
        output?: unknown;
      };
      if (!isToolSearchPart(p)) continue;
      if (p.state !== "output-available") continue;
      const output = p.output as ToolSearchOutput | undefined;
      if (!output || !Array.isArray(output.matches)) continue;
      for (const match of output.matches as ToolSearchMatch[]) {
        if (match && typeof match.name === "string") {
          loaded.add(match.name);
        }
      }
    }
  }
  return loaded;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `bun --cwd packages/cli test src/lib/inference/loaded-deferred-tools.test.ts`
Expected: PASS.

---

## Task 4: Port `buildSystemPrompt` into the CLI

**Files:**

- Create: `packages/cli/src/lib/inference/system-prompt.ts`
- Test: `packages/cli/src/lib/inference/system-prompt.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
// packages/cli/src/lib/inference/system-prompt.test.ts
import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "./system-prompt";

describe("buildSystemPrompt", () => {
  test("BUILD mode names the build section and Write tool", () => {
    const p = buildSystemPrompt({ mode: "BUILD" });
    expect(p).toContain("Mode: BUILD");
    expect(p).toContain("Write");
  });

  test("PLAN mode is read-only and omits the build section", () => {
    const p = buildSystemPrompt({ mode: "PLAN" });
    expect(p).toContain("Mode: PLAN");
    expect(p).not.toContain("Mode: BUILD");
  });

  test("lists available deferred tools in a system-reminder", () => {
    const p = buildSystemPrompt({
      mode: "BUILD",
      availableDeferredTools: ["WebSearch", "WebFetch"],
    });
    expect(p).toContain("<system-reminder>");
    expect(p).toContain("WebSearch");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bun --cwd packages/cli test src/lib/inference/system-prompt.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `system-prompt.ts`** — copy the **entire** contents of `packages/server/src/system-prompt.ts` verbatim (it imports only `type { ModeType } from "@knightcode/shared"` — no server deps). Do not edit the body.

- [ ] **Step 4: Run it — expect PASS**

Run: `bun --cwd packages/cli test src/lib/inference/system-prompt.test.ts`
Expected: PASS.

---

## Task 5: Store singleton + conversation adapter

**Files:**

- Modify: `packages/cli/src/lib/store/client.ts` (add `getStore`)
- Create: `packages/cli/src/lib/store/conversation.ts`
- Create: `packages/cli/src/lib/store/conversation.test.ts`
- Modify: `packages/cli/src/lib/store/index.ts` (export conversation)

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/store/conversation.test.ts
import { describe, expect, test } from "bun:test";
import { createStore } from "./client";
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
    // second call must not throw or overwrite the title
    expect(loadConversation(db, "s1")).toEqual([]);
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
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bun --cwd packages/cli test src/lib/store/conversation.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3a: Add `getStore()` to `client.ts`** (append at end):

```ts
let cachedStore: Store | undefined;

/** Process-wide lazy singleton over the default db path. */
export function getStore(): Store {
  if (!cachedStore) cachedStore = createStore();
  return cachedStore;
}
```

- [ ] **Step 3b: Create `conversation.ts`**

Design notes: `Message` (the UIMessage subtype) is defined in `hooks/use-chat.ts`; to avoid a circular import the adapter stays generic over a minimal `StoredUIMessage` shape and the caller casts. `replaceSessionMessages` deletes all rows for the session then re-inserts with fresh `ord` 1..N (single local process — no race). The error sentinel: callers mark a doomed assistant turn by setting `metadata.__status = "error"`; we persist that to the row's `status` column and filter it on load (mirrors the server's `status !== "error"` filter).

```ts
import { asc, eq } from "drizzle-orm";
import type { Store } from "./client";
import { messageTable, sessionTable } from "./schema";

export type StoredUIMessage = {
  id: string;
  role: string;
  parts: unknown[];
  metadata?: Record<string, unknown> | null;
};

export type EnsureSessionInput = {
  id: string;
  directory: string;
  title: string;
  model?: string | null;
  reasoningEffort?: string;
};

/** Insert a session row if one does not already exist (no-op otherwise). */
export function ensureSession(db: Store, input: EnsureSessionInput): void {
  const now = Date.now();
  db.insert(sessionTable)
    .values({
      id: input.id,
      directory: input.directory,
      title: input.title,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? "medium",
      timeCreated: now,
      timeUpdated: now,
    })
    .onConflictDoNothing()
    .run();
}

function readUsage(metadata: Record<string, unknown> | null | undefined): {
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
} {
  const usage = (metadata?.usage ?? null) as {
    inputTokens?: number;
    outputTokens?: number;
  } | null;
  const durationMs = metadata?.durationMs;
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    durationMs: typeof durationMs === "number" ? durationMs : null,
  };
}

/**
 * Replace the whole transcript for a session: delete existing rows, re-insert
 * in array order with ords 1..N. Used by the transport's onFinish and by
 * compact/clear/rewind. Runs in one synchronous bun:sqlite transaction.
 */
export function replaceSessionMessages(
  db: Store,
  sessionId: string,
  messages: ReadonlyArray<StoredUIMessage>,
): void {
  db.transaction((tx) => {
    tx.delete(messageTable).where(eq(messageTable.sessionId, sessionId)).run();
    let ord = 0;
    for (const m of messages) {
      ord += 1;
      const metadata = m.metadata ?? null;
      const status =
        (metadata?.__status as string | undefined) === "error"
          ? "error"
          : "complete";
      const usage = readUsage(metadata);
      tx.insert(messageTable)
        .values({
          id: m.id,
          sessionId,
          role: m.role,
          parts: m.parts,
          metadata,
          status,
          ord,
          timeStarted: null,
          timeCompleted: Date.now(),
          durationMs: usage.durationMs,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })
        .run();
    }
    tx.update(sessionTable)
      .set({ timeUpdated: Date.now() })
      .where(eq(sessionTable.id, sessionId))
      .run();
  });
}

/** Load a session's transcript as UIMessage-shaped objects, dropping error rows. */
export function loadConversation(
  db: Store,
  sessionId: string,
): StoredUIMessage[] {
  return db
    .select()
    .from(messageTable)
    .where(eq(messageTable.sessionId, sessionId))
    .orderBy(asc(messageTable.ord))
    .all()
    .filter((row) => row.status !== "error")
    .map((row) => ({
      id: row.id,
      role: row.role,
      parts: (row.parts ?? []) as unknown[],
      metadata: (row.metadata ?? undefined) as
        | Record<string, unknown>
        | undefined,
    }));
}
```

- [ ] **Step 3c: Export from `index.ts`** — add `export * from "./conversation";`

- [ ] **Step 4: Run it — expect PASS**

Run: `bun --cwd packages/cli test src/lib/store/conversation.test.ts`
Expected: PASS (all four cases).

---

## Task 6: `buildRequestContext` (per-turn context gatherer)

**Files:**

- Create: `packages/cli/src/lib/inference/build-request-context.ts`
- Test: `packages/cli/src/lib/inference/build-request-context.test.ts`

This lifts the context assembly out of `use-chat`'s old `prepareSendMessagesRequest` so the transport stays thin. Returns everything `buildSystemPrompt` needs except `mode` and `availableDeferredTools` (the transport supplies those).

- [ ] **Step 1: Write the failing smoke test** (runs against the repo cwd; asserts shape, not exact values):

```ts
// packages/cli/src/lib/inference/build-request-context.test.ts
import { describe, expect, test } from "bun:test";
import { buildRequestContext } from "./build-request-context";

describe("buildRequestContext", () => {
  test("returns a prompt-context object for a real directory", () => {
    const ctx = buildRequestContext(process.cwd());
    expect(typeof ctx.platform).toBe("string");
    expect(typeof ctx.shellName).toBe("string");
    expect(Array.isArray(ctx.frameworks)).toBe(true);
    expect(typeof ctx.hasPersistedTasks).toBe("boolean");
    // string-or-undefined fields must never be null
    expect(
      ctx.gitBranchName === undefined || typeof ctx.gitBranchName === "string",
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bun --cwd packages/cli test src/lib/inference/build-request-context.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `build-request-context.ts`** — moves the loaders that `use-chat.ts:128-154` called inside `prepareSendMessagesRequest`:

```ts
import { ALL_TOOL_NAMES } from "@knightcode/shared";
import { loadProjectContextSync } from "../context/project-context";
import { loadRulesText } from "../context/rules";
import { buildSkillIndex } from "../context/skills";
import { loadGitContext } from "../git/git-context";
import { detectProjectStackSync } from "../project-detection";
import { detectShell } from "../shell";
import { loadAgents, formatAgentLines } from "../agents/loader";
import { hasIncompleteTasksSync } from "../tools";

export type RequestContext = {
  globalInstructions?: string;
  projectInstructions?: string;
  localInstructions?: string;
  rules?: string;
  skillIndex?: string;
  gitBranchName?: string;
  gitStatus?: string;
  gitDiffSummary?: string;
  frameworks: string[];
  packageManager?: string;
  isTypeScript: boolean;
  shellName: string;
  platform: string;
  hasPersistedTasks: boolean;
  agentTypes: string;
};

/** Gather the per-turn workspace context the system prompt is built from. */
export function buildRequestContext(cwd: string): RequestContext {
  const projectCtx = loadProjectContextSync(cwd);
  const gitCtx = loadGitContext(cwd);
  const stackCtx = detectProjectStackSync(cwd);
  return {
    globalInstructions: projectCtx.globalInstructions,
    projectInstructions: projectCtx.projectInstructions,
    localInstructions: projectCtx.localInstructions,
    rules: loadRulesText(cwd),
    skillIndex: buildSkillIndex(cwd),
    gitBranchName: gitCtx.branchName,
    gitStatus: gitCtx.status,
    gitDiffSummary: gitCtx.diffSummary,
    frameworks: stackCtx.frameworks,
    packageManager: stackCtx.packageManager,
    isTypeScript: stackCtx.isTypeScript,
    shellName: detectShell().name,
    platform: process.platform,
    hasPersistedTasks: hasIncompleteTasksSync(cwd),
    agentTypes: formatAgentLines(loadAgents(cwd), [...ALL_TOOL_NAMES]),
  };
}
```

> If type-check flags any field above as possibly `null` (e.g. `gitCtx.branchName`), normalize with `?? undefined` to keep the `string | undefined` contract. Match the exact return types of the existing loaders — they are the same calls `use-chat.ts` already makes, so no signature surprises.

- [ ] **Step 4: Run it — expect PASS**

Run: `bun --cwd packages/cli test src/lib/inference/build-request-context.test.ts`
Expected: PASS.

---

## Task 7: Local `compactConversation`

**Files:**

- Create: `packages/cli/src/lib/inference/compact-conversation.ts`
- Test: `packages/cli/src/lib/inference/compact-conversation.test.ts`

Port of `packages/server/src/routes/compact.ts` **inference logic only** — drop Prisma, credits, billing, and the DB transaction (the caller persists via `replaceSessionMessages`). The summarizer is injectable so we can test the slice/preserve/metadata logic without a live model.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/lib/inference/compact-conversation.test.ts
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
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bun --cwd packages/cli test src/lib/inference/compact-conversation.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `compact-conversation.ts`**

```ts
import {
  getToolContracts,
  type ModeType,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import {
  convertToModelMessages,
  generateText,
  validateUIMessages,
  type ModelMessage,
} from "ai";
import { resolveModel } from "./resolve-model";

export const COMPACTION_PROMPT = `You are an expert technical coordinator. Your task is to analyze the conversation history between a developer and a coding assistant and compile a comprehensive, highly-structured, and dense engineering state summary. This summary will be used to compact the chat history so that the assistant retains complete, high-fidelity context of all work completed, files read/modified, active goals, design decisions, and unresolved issues, without needing to re-read the raw messages.

Format the summary as a markdown block with the following sections:

# ENGINEERING STATE SUMMARY

## 1. Primary Objectives & Active Goals
- Detailed breakdown of what the user is currently trying to achieve.
- The overarching goal of the session and the specific tasks in focus.

## 2. Current Implementation Status
- Step-by-step summary of what has been accomplished so far.
- What is currently in progress.
- What is planned next.

## 3. Files Read & Modified
- For each file accessed or edited:
  - 'path/to/file': Action (READ / CREATE / MODIFY) - Brief description of what was read or what exact changes were made. Be specific.

## 4. Key Architectural & Design Decisions
- Constraints specified by the user or identified from the environment.
- Architectural patterns, choices of models/libraries, or styling preferences agreed upon.
- Important rationale behind why things were built a certain way.

## 5. Technical Context & State
- State of any compilers, servers, or environment variables (e.g., ports, runtime errors found, mock setups, api credentials).
- Known errors that were hit and how they were resolved (or if they are still blocking).

## 6. Open Issues & Tech Debt
- Known bugs, regressions, or unhandled edge cases.
- Performance concerns, missing validation, or areas of code that need cleanup/polishing.
- Stated next steps that have not yet been executed.

---
Produce only this summary. Be extremely precise, technical, and complete. Do not omit any crucial context, file paths, or developer instructions. Do not add conversational intro/outro.`;

function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export function estimateTokensForMessages(messages: any[]): number {
  let tokens = 0;
  for (const msg of messages) {
    if (!msg) continue;
    if (typeof msg.content === "string")
      tokens += estimateTokensForText(msg.content);
    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (!part) continue;
        if (part.type === "text" && typeof part.text === "string") {
          tokens += estimateTokensForText(part.text);
        } else if (part.type === "reasoning" && typeof part.text === "string") {
          tokens += estimateTokensForText(part.text);
        } else if (
          typeof part.type === "string" &&
          (part.type === "dynamic-tool" || part.type.startsWith("tool-"))
        ) {
          if (part.input)
            tokens += estimateTokensForText(JSON.stringify(part.input));
          if (part.output)
            tokens += estimateTokensForText(JSON.stringify(part.output));
        }
      }
    }
  }
  return tokens;
}

export type CompactConversationInput = {
  messages: any[];
  model: string;
  mode: ModeType;
  reasoningEffort?: ReasoningEffortLevel;
  /** Injected for testability; defaults to a generateText call via resolveModel. */
  summarize?: (modelMessages: ModelMessage[]) => Promise<string>;
};

export type CompactConversationResult = {
  compactedMessages: any[];
  estimatedTokens: number;
};

/**
 * Summarize everything before the last 4 messages into a single compaction
 * message, preserving the tail. Pure inference + assembly; the caller persists.
 */
export async function compactConversation(
  input: CompactConversationInput,
): Promise<CompactConversationResult> {
  const { messages, model, mode } = input;

  if (messages.length <= 4) {
    return {
      compactedMessages: messages,
      estimatedTokens: 1500 + estimateTokensForMessages(messages),
    };
  }

  const tools = getToolContracts(mode);
  const validated = await validateUIMessages({
    messages: messages as any[],
    tools: tools as any,
  });

  const toSummarize = validated.slice(0, -4);
  const preserved = validated.slice(-4);
  const lastSummarized = toSummarize[toSummarize.length - 1];
  const compactionId = `compaction-${lastSummarized?.id ?? "initial"}`;

  const modelMessages = await convertToModelMessages(toSummarize, {
    tools: tools as any,
  });
  const compMessages: ModelMessage[] = [
    ...modelMessages,
    {
      role: "user",
      content:
        "Generate the engineering state summary of the conversation so far. Format it exactly as instructed.",
    },
  ];

  const summarize =
    input.summarize ??
    (async (mm: ModelMessage[]) => {
      const resolved = resolveModel(model, input.reasoningEffort ?? "medium");
      const result = await generateText({
        model: resolved.model,
        system: COMPACTION_PROMPT,
        messages: mm,
        providerOptions: resolved.providerOptions,
      });
      return result.text;
    });

  const summaryText = await summarize(compMessages);

  const summaryMessage = {
    id: compactionId,
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: summaryText }],
    metadata: {
      isCompaction: true,
      model,
      originalMessageCount: messages.length,
      summaryCount: 1,
      preservedCount: preserved.length,
    } as Record<string, unknown>,
  };

  const compactedMessages = [summaryMessage, ...preserved];
  const estimatedTokens = 1500 + estimateTokensForMessages(compactedMessages);

  // Keep the status bar honest: put the estimated context size on the last
  // assistant message's usage, and zero out the others' usage.
  const lastAssistant = [...compactedMessages]
    .reverse()
    .find((m: any) => m && m.role === "assistant") as any;
  if (lastAssistant) {
    for (const m of compactedMessages as any[]) {
      if (m && m !== lastAssistant && m.metadata) delete m.metadata.usage;
    }
    lastAssistant.metadata = lastAssistant.metadata ?? {};
    lastAssistant.metadata.usage = {
      inputTokens: estimatedTokens,
      outputTokens: lastAssistant.metadata.usage?.outputTokens ?? 0,
    };
  }

  return { compactedMessages, estimatedTokens };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `bun --cwd packages/cli test src/lib/inference/compact-conversation.test.ts`
Expected: PASS (both cases).

---

## Task 8: `LocalChatTransport`

**Files:**

- Create: `packages/cli/src/lib/inference/local-chat-transport.ts`

No unit test (needs a live model + the full tool registry); correctness is gated by `check-types` and the manual smoke at the end. Keep it thin — it only composes already-tested pieces.

- [ ] **Step 1: Create `local-chat-transport.ts`**

```ts
import {
  DEFAULT_CHAT_MODEL_ID,
  getDeferredToolNames,
  getToolContracts,
  TASK_SUITE_TOOL_NAMES,
  type ModeType,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type ChatTransport,
  type LanguageModelUsage,
  type UIMessageChunk,
} from "ai";
import type { Message } from "../../hooks/use-chat";
import { getSession } from "../store";
import { getStore } from "../store/client";
import { replaceSessionMessages } from "../store/conversation";
import { buildRequestContext } from "./build-request-context";
import { extractLoadedDeferredTools } from "./loaded-deferred-tools";
import { resolveModel } from "./resolve-model";
import { buildSystemPrompt } from "./system-prompt";

export type LocalChatTransportOptions = {
  sessionId: string;
  cwd?: string;
  defaultMode?: ModeType;
  getApiKey?: () => string | undefined;
};

/**
 * AI SDK ChatTransport that streams directly from OpenRouter instead of POSTing
 * to a server. Builds the system prompt + tool set locally, runs streamText,
 * and returns its UI-message stream — preserving useChat's tool-loop state
 * machine. Persists the finished transcript to the local sqlite store.
 */
export class LocalChatTransport implements ChatTransport<Message> {
  constructor(private readonly options: LocalChatTransportOptions) {}

  async sendMessages(
    options: Parameters<ChatTransport<Message>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal } = options;
    const cwd = this.options.cwd ?? process.cwd();
    const sessionId = this.options.sessionId;

    const last = messages[messages.length - 1];
    const metaSource = messages.findLast(
      (m) => m.metadata?.mode && m.metadata?.model,
    )?.metadata;
    const mode: ModeType = (last?.metadata?.mode ??
      metaSource?.mode ??
      this.options.defaultMode ??
      "BUILD") as ModeType;
    const modelId =
      last?.metadata?.model ?? metaSource?.model ?? DEFAULT_CHAT_MODEL_ID;

    const reasoningEffort = (getSession(getStore(), sessionId)
      ?.reasoningEffort ?? "medium") as ReasoningEffortLevel;

    const ctx = buildRequestContext(cwd);

    // Tool assembly mirrors the old server route: base + already-loaded
    // deferred tools (+ the Task suite when the workspace has pending tasks),
    // and announce the still-unloaded deferred tools via the system prompt.
    const loadedDeferred = extractLoadedDeferredTools(messages);
    if (ctx.hasPersistedTasks) {
      for (const name of TASK_SUITE_TOOL_NAMES) loadedDeferred.add(name);
    }
    const tools = getToolContracts(mode, { loaded_deferred: loadedDeferred });
    const availableDeferredTools = getDeferredToolNames(mode).filter(
      (name) => !loadedDeferred.has(name),
    );

    const resolved = resolveModel(modelId, reasoningEffort, {
      getApiKey: this.options.getApiKey,
    });

    const validated = await validateUIMessages<Message>({ messages, tools });
    const modelMessages = await convertToModelMessages(validated, { tools });

    const startTime = Date.now();
    let accumulatedUsage: LanguageModelUsage | null = null;

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
      onStepFinish(event) {
        const u = event.usage;
        if (!u) return;
        accumulatedUsage = accumulatedUsage
          ? {
              ...accumulatedUsage,
              inputTokens:
                (accumulatedUsage.inputTokens ?? 0) + (u.inputTokens ?? 0),
              outputTokens:
                (accumulatedUsage.outputTokens ?? 0) + (u.outputTokens ?? 0),
              totalTokens:
                (accumulatedUsage.totalTokens ?? 0) + (u.totalTokens ?? 0),
            }
          : u;
      },
    });

    return result.toUIMessageStream<Message>({
      originalMessages: validated,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { mode, model: modelId };
        if (part.type !== "finish") return undefined;
        return {
          mode,
          model: modelId,
          durationMs: Date.now() - startTime,
          ...(accumulatedUsage ? { usage: accumulatedUsage } : {}),
        };
      },
      onFinish: ({ messages: finalMessages, isAborted }) => {
        try {
          const persisted = isAborted
            ? finalMessages.map((m, i) =>
                i === finalMessages.length - 1 && m.role === "assistant"
                  ? { ...m, metadata: { ...m.metadata, isInterrupted: true } }
                  : m,
              )
            : finalMessages;
          replaceSessionMessages(getStore(), sessionId, persisted as never);
        } catch (err) {
          console.error("Failed to persist conversation:", err);
        }
      },
      onError: (error) =>
        error instanceof Error ? error.message : String(error),
    }) as unknown as ReadableStream<UIMessageChunk>;
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // No resumable server-side streams in local mode.
    return null;
  }
}
```

- [ ] **Step 2: Type-check gate** (full wiring lands in Task 9; this confirms the transport itself type-checks once imported):

Run: `bun --cwd packages/cli run check-types`
Expected: no errors originating in `local-chat-transport.ts`. (Unused-import warnings about `apiClient` etc. resolve in Task 9.)

> If `toUIMessageStream`'s return type does not assign to `ReadableStream<UIMessageChunk>` cleanly, the `as unknown as` cast above already bridges it; keep the cast minimal and commented.

---

## Task 9: Wire `use-chat.ts` to the local transport, compaction, and store

**Files:**

- Modify: `packages/cli/src/hooks/use-chat.ts`

- [ ] **Step 1: Swap imports.** Remove the server transport + api-client + auth imports and add the local ones.

Replace:

```ts
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { apiClient } from "../lib/api-client";
import { getAuth } from "../lib/auth/auth";
```

with:

```ts
import {
  lastAssistantMessageIsCompleteWithToolCalls,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { LocalChatTransport } from "../lib/inference/local-chat-transport";
import { compactConversation } from "../lib/inference/compact-conversation";
import { getStore } from "../lib/store/client";
import { replaceSessionMessages } from "../lib/store/conversation";
import { getOpenRouterApiKey } from "../lib/credentials";
```

- [ ] **Step 2: Replace the `transport` memo** (lines ~108-159) — the whole `DefaultChatTransport({...})` block — with:

```ts
const transport = useMemo(() => {
  return new LocalChatTransport({
    sessionId,
    cwd: process.cwd(),
    getApiKey: getOpenRouterApiKey,
  });
}, [sessionId]);
```

> This deletes the inline `prepareSendMessagesRequest` body — its context assembly now lives in `buildRequestContext`, called inside the transport. The `loadProjectContextSync` / `loadGitContext` / `detectProjectStackSync` / `loadRulesText` / `buildSkillIndex` / `loadAgents` / `formatAgentLines` / `detectShell` / `hasIncompleteTasksSync` / `ALL_TOOL_NAMES` imports become unused **in this file** — remove the now-unused ones (verify with check-types; some, like `hasIncompleteTasksSync` from `../lib/tools`, are also used elsewhere in the file — only drop truly-unused imports).

- [ ] **Step 3: Replace the server compaction call** inside `compactHistory` (lines ~394-451). Replace the `try { const res = await apiClient.compact.$post({...}); if (res.ok) {...} else {...} } catch (err) {...}` block with a local call:

```ts
try {
  const { compactedMessages } = await compactConversation({
    messages: currentMessages as any[],
    model: activeModelId,
    mode: activeMode,
  });

  if (compactedMessages !== currentMessages) {
    // Preserve any messages that arrived during the async summarize.
    const freshAfterCompact = chatRef.current.messages as Message[];
    const sentIds = new Set(currentMessages.map((m) => m.id));
    const trailing = freshAfterCompact.filter((m) => !sentIds.has(m.id));
    const freshMap = new Map(freshAfterCompact.map((m) => [m.id, m]));

    const toSummarize = currentMessages.slice(0, -4);
    const lastSummarizedMessage = toSummarize[toSummarize.length - 1];
    const compactionId = `compaction-${lastSummarizedMessage?.id || "initial"}`;
    const merged = (compactedMessages as Message[]).map((m) =>
      m.id !== compactionId && freshMap.has(m.id) ? freshMap.get(m.id)! : m,
    );

    const finalMerged = [...merged, ...trailing];
    chatRef.current.setMessages(finalMerged);
    replaceSessionMessages(getStore(), sessionId, finalMerged as never);
    toast.show({ variant: "success", message: "Context compacted." });
    return;
  }
} catch (err) {
  console.error("Compaction error, falling back to naive compaction:", err);
}
```

> The existing **fallback naive compaction** block below this (lines ~453-696) stays unchanged. Its final persistence call (Step 4) is the only edit there.

- [ ] **Step 4: Replace the 3 `apiClient.sessions[":id"].$patch` calls** with local store writes.

In `compactHistory` (the naive-fallback tail, ~698-705):

```ts
try {
  replaceSessionMessages(getStore(), sessionId, finalMessagesForPatch as never);
} catch (err) {
  console.error("Failed to persist compacted messages:", err);
}
```

In `clearMessages` (~717-724):

```ts
try {
  replaceSessionMessages(getStore(), sessionId, []);
} catch (err) {
  console.error("Failed to clear messages:", err);
}
```

In `rewindMessages` (~783-790):

```ts
try {
  replaceSessionMessages(getStore(), sessionId, merged as never);
} catch (err) {
  console.error("Failed to persist rewound messages:", err);
}
```

> These are synchronous now, but keeping them inside the existing `async` functions / `try` blocks is harmless and minimizes diff. The `await` keyword can be dropped or left (awaiting a non-promise is a no-op) — drop it to satisfy lint.

- [ ] **Step 5: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors in `use-chat.ts`. Resolve any "declared but never used" by removing the dead imports from Step 2.

---

## Task 10: Local subagent `callStep`

**Files:**

- Modify: `packages/cli/src/lib/tools/Agent/execute.ts`

- [ ] **Step 1: Swap the import.** Remove `import { apiClient } from "../../api-client";` and add:

```ts
import { getToolContractsByNames } from "@knightcode/shared";
import { generateText } from "ai";
import { resolveModel } from "../../inference/resolve-model";
```

> `ModeType`, `ModelMessage`, `DEFAULT_CHAT_MODEL_ID`, `Agent`, `ALL_TOOL_NAMES`, `KnightcodeTool` are already imported at the top — keep them.

- [ ] **Step 2: Replace the `callStep` body** (lines ~88-98) with a local `generateText` call through the same resolver:

```ts
const callStep = async (req: {
  system: string;
  messages: ModelMessage[];
  toolNames: string[];
  mode: ModeType;
  model: string;
}): Promise<SubagentStepResult> => {
  const resolved = resolveModel(req.model, "medium");
  const tools = getToolContractsByNames(req.toolNames);
  const result = await generateText({
    model: resolved.model,
    system: req.system,
    messages: req.messages,
    tools,
    providerOptions: resolved.providerOptions,
  });
  return {
    text: result.text,
    toolCalls: result.toolCalls.map((tc) => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    })),
    finishReason: result.finishReason,
    usage: result.usage ?? null,
  };
};
```

- [ ] **Step 3: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors in `execute.ts`.

---

## Task 11: Repoint the active session create/load to the local store

**Files:**

- Modify: `packages/cli/src/screens/new-session.tsx`
- Modify: `packages/cli/src/screens/session.tsx`

These are the **main chat path** (create → open → chat), not the deferred dialogs. Repointing them makes the loop server-independent end-to-end.

- [ ] **Step 1: `new-session.tsx` — create in the local store.** Replace the `apiClient` import:

```ts
import { getStore } from "../lib/store/client";
import { createSession } from "../lib/store";
```

(remove `import { apiClient } from "../lib/api-client";` and `getErrorMessage` if it becomes unused.)

Replace the `createSession` async closure body (the `apiClient.sessions.$post({...})` call and its result handling, ~51-85) with a synchronous local create:

```ts
const create = () => {
  try {
    const row = createSession(getStore(), {
      directory: process.cwd(),
      title: state.message.slice(0, 100),
      model: state.model,
      reasoningEffort: state.reasoningEffort,
    });
    if (ignore) return;
    navigate(`/sessions/${row.id}`, {
      replace: true,
      state: {
        session: { ...row, messages: [] },
        initialPrompt: {
          message: state.message,
          mode: state.mode,
          model: state.model,
        },
      },
    });
  } catch (error) {
    if (ignore) return;
    toast.show({
      variant: "error",
      message:
        error instanceof Error ? error.message : "Failed to create session",
    });
    navigate("/", { replace: true });
  }
};

create();
```

> Keep the `let ignore = false; ... return () => { ignore = true; };` scaffold around it. The `async`/`await` go away.

- [ ] **Step 2: `session.tsx` — define a local `SessionData` and load from the store.**

Replace the Hono-derived type:

```ts
type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;
```

with a store-derived shape:

```ts
import type { SessionRow } from "../lib/store";
import type { Message } from "../hooks/use-chat";

type SessionData = SessionRow & { messages: Message[] };
```

(remove the now-unused `InferResponseType` import and `import { apiClient } from "../lib/api-client";` if nothing else in the file uses them — `getErrorMessage` import too if unused.)

Replace the `fetchSession` effect (the `apiClient.sessions[":id"].$get({...})` block, ~362-395) with a synchronous local load:

```ts
useEffect(() => {
  if (prefetched?.session) return;
  setSession(null);
  if (!id) return;

  try {
    const db = getStore();
    const row = getSession(db, id);
    if (!row) throw new Error("Session not found");
    const messages = loadConversation(db, id) as unknown as Message[];
    setSession({ ...row, messages });
  } catch (err) {
    toast.show({
      variant: "error",
      message: err instanceof Error ? err.message : "Failed to load session",
    });
    navigate("/", { replace: true });
  }
}, [id, prefetched, toast, navigate]);
```

Add imports:

```ts
import { getStore } from "../lib/store/client";
import { getSession } from "../lib/store";
import { loadConversation } from "../lib/store/conversation";
```

> `SessionChat` reads `session.messages`, `session.id`, `session.reasoningEffort` — all present on the new `SessionData`. No further changes needed there.

- [ ] **Step 3: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors. Fix any residual unused imports flagged in `new-session.tsx` / `session.tsx`.

---

## Task 12: Full validation + single commit

**Files:** none (validation + commit)

- [ ] **Step 1: Full type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: clean.

- [ ] **Step 2: Full CLI test suite**

Run: `bun --cwd packages/cli test`
Expected: all green (existing store/credentials/paths tests + new inference + conversation tests).

- [ ] **Step 3: Shared test suite**

Run: `bun --cwd packages/shared test`
Expected: green (shortlist + existing tool/schema tests).

- [ ] **Step 4: Manual smoke (optional but recommended)** — with `OPENROUTER_API_KEY` exported, run `bun --cwd packages/cli run dev`, start a new session, confirm tokens stream from OpenRouter, a tool call executes, `/compact` works, and reopening the session reloads the transcript from `~/.knightcode/knightcode.db`.

- [ ] **Step 5: ONE commit for the whole phase** (user override — no per-task commits):

```bash
git add packages/shared/src/models.ts packages/shared/src/index.ts \
  packages/shared/src/models.shortlist.test.ts \
  packages/cli/src/lib/inference/ \
  packages/cli/src/lib/store/client.ts \
  packages/cli/src/lib/store/conversation.ts \
  packages/cli/src/lib/store/conversation.test.ts \
  packages/cli/src/lib/store/index.ts \
  packages/cli/src/hooks/use-chat.ts \
  packages/cli/src/lib/tools/Agent/execute.ts \
  packages/cli/src/screens/session.tsx \
  packages/cli/src/screens/new-session.tsx \
  packages/cli/package.json bun.lock
git commit -m "feat(cli): stream inference directly from OpenRouter (BYOK)

Replace the hosted-server chat path with a local ChatTransport that streams
from OpenRouter via the user's key. Move compaction and the subagent step
local through a shared resolveModel, build the system prompt + tool set in the
CLI, and wire the bun:sqlite store into the active session's load/persist.
Add a curated model shortlist to @knightcode/shared.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Do **not** push or open the PR — the user does that. Do not delete the server or `api-client.ts` (that's `strip-server`).

---

## Self-review checklist (run before executing)

- **Spec coverage:** §6.1 LocalChatTransport (Task 8) ✓ · §6.2 resolveModel + shortlist (Tasks 1-2) ✓ · §6.3 subagent step local (Task 10) ✓ · §6.4 compaction local (Task 7) ✓ · store wired into main path (Tasks 5, 9, 11) ✓. §6.5 web tools / §6.7-6.9 are later phases — out of scope here. ✓
- **Type consistency:** `resolveModel(modelId, effort, opts)` returns `{ model, modelId, providerOptions? }` — same shape consumed in Tasks 7, 8, 10. `replaceSessionMessages(db, sessionId, messages)` / `loadConversation(db, sessionId)` / `ensureSession(db, input)` / `getStore()` signatures match across Tasks 5, 8, 9, 11. `buildRequestContext(cwd)` keys map 1:1 onto `buildSystemPrompt` params (Task 8). ✓
- **Phase boundary:** server, `api-client.ts`, OAuth, and the sessions-list/stats/doctor/rename dialogs are untouched. ✓
- **Commit policy:** single commit in Task 12; no per-task commits. ✓
