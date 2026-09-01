# Knightcode Query Engine — Design

**Date:** 2026-06-10
**Status:** Approved direction (Option A — engine-first, incremental adoption)
**Goal:** Replace the React-hosted agent loop with a standalone query engine modeled on claude-code's harness, with the Ink UI updated hand-in-hand at every phase.

## Problem

Knightcode's agent loop lives inside the UI: `@ai-sdk/react`'s `useChat` runs in Ink, `onToolCall` executes tools on the UI thread, and `sendAutomaticallyWhen` re-POSTs the transcript after each tool round. Consequences observed in practice:

1. **"Tool results missing for tool call <id>" errors.** Interrupted/errored streams persist assistant messages containing tool calls with no `tool_result`. The next request replays the broken transcript and the provider rejects it. There is no repair pass.
2. **Slow tool rounds.** `buildRequestContext` already memoizes its static slice (instructions, skills, stack, agents — `build-request-context.ts:35`), but the volatile slice (git branch/status/diff via spawned git commands, task-state scan) re-runs on every tool round; the full transcript is re-validated (`validateUIMessages`) and re-converted (`convertToModelMessages`) every round; tool execution is serialized through React state updates and re-renders before the next request fires.
3. **Subagents run sequentially.** Foreground `Agent` calls go through `pendingConfirmations`, and `confirmToolCall` awaits the entire subagent run inside the confirm handler. Subagents also use a bespoke mini-loop (`run-subagent.ts`) instead of the main harness.
4. **Crude truncation.** `MAX_BASH_OUTPUT=50_000` chars cut at the end (no head+tail preservation, no retrieval hint), `DEFAULT_READ_LIMIT=200` lines. The naive compactor destructively overwrites persisted tool outputs with `[Tool Output Cleared]`.
5. **Generic tool UI.** One `tool-call-view.tsx` for all tools vs claude-code's per-tool renderers (inline diffs, grouped read/search collapsing, agent progress lines, exit-code-aware bash output).

Reference: `claude-code/src/query.ts` (1,729-line standalone async-generator loop), `QueryEngine.ts`, `services/tools/toolOrchestration.ts`, `utils/conversationRecovery.ts`, `services/compact/*`.

## Decisions (locked)

- **Standalone engine**, not patches to the useChat loop.
- **Keep AI SDK core** (`ai` package: `streamText` single-step, message types, provider handling for OpenRouter). Drop `@ai-sdk/react` as the loop.
- **All capabilities in scope:** concurrent tool scheduler, per-turn context caching, recovery paths, engine-owned compaction, subagents on the engine, truncation overhaul, tool UI parity.
- **UI updated in lockstep** with each engine phase, not as a trailing phase.
- **Store keeps the UIMessage format** — no persistence migration.
- A **full harness comparison document** (`docs/harness-comparison.md`) is written first and drives the phases.

## Architecture

New module `packages/cli/src/lib/engine/` — UI-free, directly unit-testable.

### `engine/query.ts` — the loop

```
async function* query(params: QueryParams): AsyncGenerator<EngineEvent, Terminal>
```

Per round: cached request context → `streamText` (single step) → if tool calls: scheduler runs them → append results → continue; else terminate. Mutable cross-round state held in a single `State` object (claude-code's pattern). The same generator runs the main thread and subagents.

**EngineEvent** (typed union): `stream_start`, `message_update` (in-progress assistant UIMessage snapshot — the engine assembles parts from the model stream itself, claude-code style, so the UI renders snapshots rather than raw deltas), `tool_call`, `tool_result`, `message_complete`, `compaction_boundary`, `retry`, `permission_request`, `question_request` (AskUserQuestion — semantically a question, not a permission), `mode_change`, `turn_complete`. Terminal state reports stop reason: `complete | aborted | max_turns | error`.

**Engine `State` additionally tracks:**
- **Current mode** (`BUILD | PLAN | AUTO`). Tool results containing `modeTransition` (EnterPlanMode/ExitPlanMode today, `use-chat.ts:149-154`, `894-899`) update it and emit `mode_change` so the UI status bar and permission policy stay in sync.
- **Loaded deferred tools** — tracked in State, not re-derived by scanning message history each round (replaces `extractLoadedDeferredTools`). The system prompt builder still receives `availableDeferredTools` for the unloaded set; ToolSearch results add to State.
- **Loop protection** — per-turn `Map<toolName:inputJSON, count>`; same call >8 times is rejected with an error tool_result (TodoWrite exempt). Ported from `use-chat.ts:772-785` so the engine cannot burn tokens in a tool loop.
- **Accumulated token usage** — per-step usage summed across rounds (ports `onStepFinish` accumulation from `local-chat-transport.ts:138-152`); included in `turn_complete`.
- **Turn timing** — `turn_complete` carries `durationMs` anchored to the user's `submittedAt`, minus paused time. The engine pauses its turn clock while a `permission_request` or `question_request` is outstanding (ports `turnPausedMsRef`, `use-chat.ts:931-938`).

### `engine/transcript.ts` — message integrity

- **Repair pass** run on session load *and* after abort/error: every `tool_use` without a matching `tool_result` gets a synthetic interrupted/error result. Eliminates the "tool results missing" error class.
- Interrupt detection on restore (mirrors `conversationRecovery.ts`: `filterUnresolvedToolUses`, orphaned-thinking filtering, whitespace-only assistant filtering, turn-interruption detection → continuation marker).
- Empty assistant shells stripped (already done ad hoc in `LocalChatTransport`; moves here). Note: store-level filtering in `loadConversation` (`conversation.ts:109-113`, drops error rows and empty shells) already exists and stays — repair is a second layer that catches what filtering can't (unresolved tool calls).

### `engine/scheduler.ts` — tool orchestration

- Every tool contract gains `isConcurrencySafe(input): boolean`. Full categorization (Phase 2 implements exactly this table):

| Safe (parallel) | Unsafe (serialize) |
|---|---|
| Read, Glob, Grep | Edit, MultiEdit, Write, NotebookEdit (file writes) |
| WebFetch, WebSearch | Bash (arbitrary side effects) |
| TaskList, TaskGet, TaskOutput | TaskCreate, TaskUpdate, TaskStop (task-store writes) |
| ToolSearch (schema loading) | Config (settings write; reads could be safe but input-dependent) |
| Skill (loads instructions) | EnterPlanMode, ExitPlanMode (mutate mode for subsequent tools) |
| TodoWrite (UI-only side effect) | AskUserQuestion (blocks on user input) |
| **Agent** (isolated sub-loop — this is what makes subagents parallel) | |

- Contiguous concurrency-safe calls run in parallel (cap ~10); unsafe calls serialize in order. Mirrors `toolOrchestration.ts`.
- **Permissions:** async `canUseTool(toolCall) → { behavior: "allow" | "deny", feedback?, updatedInput?, always? }` callback supplied by the UI. The engine awaits it; denial produces a proper error tool_result with the user's guidance. Replaces the React-state interception in `use-chat.ts`.
- **Injected policy** evaluates inside the engine (so subagents share it), preserving current semantics exactly:
  - **AUTO mode short-circuits to allow for every gated tool** — Edit, MultiEdit, Write, NotebookEdit, Bash, Agent, and Config writes (`use-chat.ts:818,834,863,876`; `Agent/execute.ts:24`). Load-bearing behavior, stated explicitly.
  - **Config:** reads (`value === undefined`) auto-allow; writes require confirmation (`use-chat.ts:860-874`).
  - **Bash:** allowlist check via persisted `permissions.json` (`isCommandAllowed`); an `always` grant calls `allowCommand` to persist the pattern.
  - **Edits:** session-scoped `alwaysAllowEdits` flag lives in engine policy state; an `always` grant for one edit also auto-approves the other pending edit confirmations (ports `use-chat.ts:197-244`).
  - **TodoWrite:** never gated; its output additionally feeds the todo panel via a dedicated UI channel, not just the tool result.
  - **Agent:** the permission response's `updatedInput` carries the user's model override (today's `setConfirmationModelOverride` → `resolveSubagentModel` flow).

### `engine/hooks.ts` — hook system integration

The existing 5-event hook system (`lib/hooks.ts`: PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop) plugs into the engine:

- Scheduler runs `runPreToolHooks` before execution and converts a block into an error tool_result (today it throws from `executeLocalTool`; same outcome, owned by the scheduler).
- `runPostToolHooks` / `runPostToolUseFailureHooks` fire after execution as today.
- **PostToolUse `systemMessage` is currently silently dropped** (`void runPostToolHooks(...)` in `tools/index.ts`). The engine fixes this: hook `systemMessage`s are collected and injected into the next round as a system-reminder block.
- `turn_complete` triggers `runStopHooks` (replaces the `onFinish` setTimeout).
- `useQueryEngine` runs `runUserPromptSubmitHooks` before submitting; a block surfaces as a toast, as today.

### `engine/context.ts` — request context caching

The static slice is already memoized (`build-request-context.ts:35`, with `invalidateRequestContextCache` for instructions/skills/agents changes). What changes: the **volatile slice** (git branch/status/diff, pending-task scan) is also cached **per user turn** instead of recomputed per round, invalidated mid-turn when a Bash tool runs a git-mutating command. Transcript→ModelMessage conversion is incremental: rounds append, no full re-validation.

### `engine/recovery.ts`

- Stream-error retry with exponential backoff (bounded attempts).
- Empty/malformed response (no text, no tool calls) → retry once, then surface.
- Context-overflow rejection → reactive compaction → retry once (mirrors `hasAttemptedReactiveCompact`).

### `engine/compaction.ts` — engine-owned

Checked between rounds, in claude-code's order:
1. **Microcompact:** clear old tool outputs by tool_use_id **in the request view only** — the persisted transcript is never destroyed (fixes today's destructive `[Tool Output Cleared]` writes).
2. **Autocompact:** summary compaction past a context-window threshold, with a `compaction_boundary` event the UI renders as a system row. Existing `compact-conversation.ts` summarization is reused.

**Boundary model (adopted from claude-code, replaces today's destructive replace):** autocompact appends a boundary message carrying the summary; the full pre-compact transcript stays in the store and in UI scrollback. The engine's request view slices from the last boundary (`getMessagesAfterCompactBoundary` pattern, `claude-code/src/query.ts:365`). Today's `replaceSessionMessages(compactedMessages)` flow — which permanently deletes the original rows — is removed.

**Post-compaction usage:** after autocompact or reactive compact, the engine updates State's accumulated usage with the re-estimated context size (ports `compact-conversation.ts:166-185`) so the status bar and `turn_complete` report post-compaction tokens.

The current naive fallback (`use-chat.ts:429-614`) has heuristics worth keeping; they move into the microcompact pass (request-view only, no longer destructive):
- Preserve outputs for the ~5 most recently accessed files (merged with `getSessionModifiedFiles`).
- Preserve failed Bash outputs (non-zero exit codes).
- Collapse search-only assistant turns (Glob/Grep/TaskList/TaskGet) into `[Search executed: …]` placeholders.
The naive path also remains the fallback when the LLM summarizer fails, as today — just relocated to `engine/compaction.ts` and made non-destructive.

### Subagents

`Agent` tool executes `query()` recursively with a restricted toolset, depth limit, and the parent's `canUseTool` (background agents auto-deny). `run-subagent.ts` deleted. Subagent engine events bubble to the parent tagged with `agentId`, enabling live nested progress in the UI. Parallelism comes from the scheduler (Agent is concurrency-safe).

**The core technical change in Phase 5 is the switch from `generateText` (non-streaming, `Agent/execute.ts:78` — subagent progress is completely invisible today) to the streaming `query()` generator.** Two current behaviors to fix while there: subagent mode is hardcoded to `"BUILD"` regardless of parent mode (`Agent/execute.ts:66`), and subagent permission gating duplicates the main-thread list minus Config/Agent — both replaced by the shared injected policy.

**Background-agent re-entry:** completions enqueue into the existing notification FIFO (`Agent/notifications.ts`); `useQueryEngine` keeps today's semantics — drain one notification per idle tick (engine idle, no pending prompts) by submitting it as a user message. The engine itself stays notification-agnostic.

### Truncation overhaul

- Head+tail middle truncation: keep first/last portions, elide the middle with `... [N lines elided — re-run with offset/limit or a narrower filter]`.
- Per-tool `maxResultSizeChars` budget enforced at transcript-assembly time (mirrors `applyToolResultBudget`), composing with microcompact.

### UI — `useQueryEngine` hook + per-tool renderers

- `useQueryEngine` replaces `useChat`/`LocalChatTransport`: consumes engine events into the render transcript, exposes `submit`, `abort`, permission/question resolvers — plus `clear()` (reset engine transcript + persist; `/clear`) and `rewind(n)` (truncate last N turn pairs + persist; `/rewind`), preserving today's semantics from `use-chat.ts:691-764`. The session-snapshot `/undo` system (`undoSessionChanges`) is untouched and keeps working.
- **Persistence strategy:** Phase 1 keeps `replaceSessionMessages` on `turn_complete` (current behavior). Incremental persistence via the existing-but-unused `appendMessage`/`updateMessage` (`store/messages.ts`) is a candidate for a later phase for crash resilience; explicitly not in scope now.
- Per-tool renderers replacing the generic view: inline diff for Edit/MultiEdit/Write (diff components already exist), exit-code-aware Bash blocks, collapsed grouping for consecutive read/search calls, live subagent progress lines, explicit interrupted-turn marker, retry/compaction system rows.

## Phases (one PR each; code committed only when a phase is finished)

| Phase | Engine | UI (lockstep) |
|---|---|---|
| **0** | `docs/harness-comparison.md` — full feature-by-feature comparison (loop, integrity, scheduling, compaction, recovery, hooks, context assembly, subagents, queueing, budgets, UI), each marked adopt-now / adopt-later / skip | — |
| **1** | Engine skeleton (`query.ts` events + single-step loop) + `transcript.ts` integrity/repair | `useQueryEngine` swap-in; interrupted-turn marker; useChat/LocalChatTransport removed |
| **2** | `scheduler.ts` + `isConcurrencySafe` on all contracts + `canUseTool` + injected policy (AUTO short-circuit, Config read/write, always-allow) + `engine/hooks.ts` + loop protection | Concurrent tool rows with spinners; permission prompts via engine requests; parallel agent progress lines |
| **3** | `context.ts` caching; incremental message conversion | Accurate phase status (streaming / running tools) from engine events |
| **4** | `recovery.ts` + `compaction.ts` (engine-owned, non-destructive) | Retry + compaction-boundary system rows |
| **5** | Subagents on recursive `query()` (generateText → streaming; fix hardcoded BUILD mode); delete `run-subagent.ts` | Nested subagent activity, collapsed + expandable |
| **6** | Truncation overhaul + result-size budgets | Per-tool renderers (diffs, bash blocks, read/search grouping) |

Each phase leaves the CLI fully working. Phase 1 is the riskiest (UI swap); everything after is additive inside the engine.

## Error handling

- Every tool execution path (success, throw, deny, abort, timeout) produces a tool_result — enforced by the scheduler, not by callers.
- **Abort contract:** abort cancels the active `streamText` call via AbortSignal and stops scheduling further tools; in-flight tool executions run to completion (matching today's behavior); the repair pass then synthesizes interrupted tool_results for any orphaned tool_uses, the partial assistant content is kept and marked `isInterrupted`, and the transcript persists. Subagents receive the same signal (checked per round, as `run-subagent.ts:52` does today; per-round granularity is acceptable).
- The scheduler executes file-mutating tools through the same executors, so the session-snapshot recording (`recordOriginalContent` in Edit/MultiEdit/Write/NotebookEdit) that powers `/undo` is preserved — verified as a Phase 2 test, not left implicit. Subagent writes share the parent `sessionId` and stay undoable.
- Engine never throws into the UI: errors become events + terminal state.
- Persistence failures are logged, never crash the loop (current behavior, kept).

## Testing

Engine is UI-free: unit tests with fake model streams (scripted `streamText` step results) and scripted tool executors, following the existing `*.test.ts` pattern. Key suites: transcript repair (interrupted/orphaned cases), scheduler ordering (safe-parallel/unsafe-serial, permission deny), recovery transitions, compaction non-destructiveness, recursive subagent depth/parallelism. UI hook gets a smoke test via scripted engines.

## Out of scope

- Provider changes (stays OpenRouter BYOK via AI SDK).
- Store schema changes.
- claude-code features unrelated to the harness (voice, IDE bridge, swarms, remote/teleport, etc.) — the Phase 0 doc will mark these skip/later.
