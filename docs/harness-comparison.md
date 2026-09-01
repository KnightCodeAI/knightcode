# Claude-Code vs Knightcode: Harness Comparison

> **STATUS (2026-06-16): partially stale — read as the original plan, not current state.**
> P1 and P2 have since shipped: the engine lives in `packages/cli/src/lib/engine/`
> (`query.ts`, `scheduler.ts`, `tool-runner.ts`, `transcript.ts`) and is wired through
> `hooks/use-query-engine.ts` → `screens/session.tsx`. **Every `use-chat.ts:NNN` and
> `local-chat-transport.ts:NNN` reference in the "knightcode today" column below points
> at files that no longer exist.** P3–P6 are still backlog, and two correctness gaps that
> this doc never covered (read-before-edit, duplicate tool calls) remain open.
> See `docs/harness-followup-2026-06-16.md` for the current assessment.

**Date:** 2026-06-10 · **Task 0 of the query-engine plan** (spec: `docs/superpowers/specs/2026-06-10-query-engine-design.md`)
**Not committed** — repo rule: docs/specs/plans never land in git.

Verdict tags: `ADOPT-P1` … `ADOPT-P6` (phase per spec), `LATER` (post-Phase-6 backlog), `SKIP` (with reason).
All claude-code refs are `claude-code/src/...`; all knightcode refs are `packages/cli/src/...`.

---

## 1. Loop architecture (generator engine vs UI-hosted useChat)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Standalone async-generator loop | `query.ts:219` `query()` → `query.ts:241` `queryLoop()`: a `while(true)` (`query.ts:307`) that per iteration runs budget/snip/microcompact/autocompact → model stream → tool execution → attachments → continue or `return Terminal`. Yields a typed stream (`StreamEvent \| Message \| TombstoneMessage \| ToolUseSummaryMessage`, return type `Terminal` — `query.ts:221-227`). UI-free; same generator serves REPL, SDK and subagents. | Loop lives inside React: `@ai-sdk/react` `useChat` (`hooks/use-chat.ts:766`) with `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` (`use-chat.ts:925`) re-POSTing the whole transcript through `LocalChatTransport.sendMessages` (`lib/inference/local-chat-transport.ts:45`) after each tool round. Tool execution happens in the React `onToolCall` callback (`use-chat.ts:770`). | **ADOPT-P1** |
| Single mutable `State` object across rounds | `query.ts:204-217` `type State` (messages, toolUseContext, autoCompactTracking, maxOutputTokensRecoveryCount, hasAttemptedReactiveCompact, maxOutputTokensOverride, pendingToolUseSummary, stopHookActive, turnCount, `transition: Continue`); continue sites write `state = {...}` whole (`query.ts:1714-1727`). | No equivalent — cross-round state is scattered across React refs (`use-chat.ts:84-97`: `chatRef`, `toolLoopCountsRef`, `alwaysAllowEditsRef`, `turnPausedMsRef`) and message metadata. | **ADOPT-P1** |
| Typed `transition` reason on every continue | `query.ts:216` State.transition records why the previous iteration continued (`next_turn`, `reactive_compact_retry` `query.ts:1162`, `max_output_tokens_recovery` `query.ts:1245`, `stop_hook_blocking` `query.ts:1302`, `collapse_drain_retry` `query.ts:1109`, `token_budget_continuation` `query.ts:1338`); built so tests can assert recovery paths fired. `query/transitions.ts` is a stub in the leak — the shapes are inferable from the continue sites. | Absent (nearest: nothing; the loop has exactly one transition kind, the implicit auto-resend in `use-chat.ts:925`). | **ADOPT-P1** |
| Terminal stop reasons | Every `return` carries a reason: `completed` (`query.ts:1357`), `aborted_streaming` (`query.ts:1051`), `aborted_tools` (`query.ts:1515`), `max_turns` (`query.ts:1711`), `model_error` (`query.ts:996`), `blocking_limit` (`query.ts:646`), `prompt_too_long` (`query.ts:1175`), `stop_hook_prevented` (`query.ts:1279`), `hook_stopped` (`query.ts:1520`), `image_error` (`query.ts:977`). | Absent — useChat exposes only `status`/`error` (`use-chat.ts:960-962`). | **ADOPT-P1** (spec's `complete \| aborted \| max_turns \| error`) |
| maxTurns limit on the main loop | `query.ts:1704-1712`: turn counter incremented per tool round, `max_turns_reached` attachment yielded, terminal returned. Also checked on abort (`query.ts:1506-1514`). | Main loop has no turn cap (only subagents: `Agent/execute.ts:67` `maxTurns = agent.maxTurns ?? 25`). | **ADOPT-P1** |
| Engine wrapper class for headless callers | `QueryEngine.ts:184` `class QueryEngine` — owns `mutableMessages`, abort controller, accumulated usage; `submitMessage()` (`QueryEngine.ts:209`) starts a turn and adapts `query()` output to SDK messages. One instance per conversation. | Absent — the closest is the `useChat` hook itself (`use-chat.ts:73`), which can only live inside Ink. | **ADOPT-P1** (as `useQueryEngine` consuming `engine/query.ts`; a non-React wrapper is **LATER**) |
| Engine assembles in-progress message snapshots for the UI | `query.ts:747-787`: each streamed assistant message is cloned, `backfillObservableInput` applied, then yielded; the UI renders message snapshots, never raw deltas. | The AI SDK's `toUIMessageStream` does this (`local-chat-transport.ts:155`); knightcode loses it when dropping `@ai-sdk/react`, so the engine must own it. | **ADOPT-P1** (`message_update` events per spec) |
| Per-turn loop/budget instrumentation checkpoints | `queryCheckpoint()` calls throughout (`query.ts:339,413,453,560,652,1363,1714`). | Absent (nearest: ad hoc `startTime` capture, `local-chat-transport.ts:104`). | **SKIP** — profiling infra, not behavior. |

## 2. Message integrity & recovery (repair, interrupt detection, orphan filtering)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Synthetic tool_results for orphaned tool_uses | `query.ts:123-149` `yieldMissingToolResultBlocks()` — for every `tool_use` without a result, yield an `is_error` tool_result user message. Invoked on model-fallback retry (`query.ts:900`), on loop throw (`query.ts:984`), and on abort without streaming executor (`query.ts:1025-1029`). StreamingToolExecutor synthesizes its own for queued/in-flight tools on abort (`StreamingToolExecutor.ts:153-205,276-291`). | Absent. Interrupted/errored streams persist assistant messages whose tool calls have no output; next request replays them and the provider rejects with "Tool results missing for tool call <id>". Nearest: `local-chat-transport.ts:93-95` only strips *empty* assistant shells. | **ADOPT-P1** (core of `engine/transcript.ts`) |
| Resume-time repair pass | `conversationRecovery.ts:164` `deserializeMessagesWithInterruptDetection()`: `filterUnresolvedToolUses` (`:187`), `filterOrphanedThinkingOnlyMessages` (`:194`), `filterWhitespaceOnlyAssistantMessages` (`:200`), then appends a synthetic assistant sentinel if the transcript ends on a user message (`:231-245`). | Partial: `store/conversation.ts:109-113` drops `status === "error"` rows and empty assistant shells on load. No unresolved-tool-use filtering, no thinking/whitespace filtering, no sentinel. | **ADOPT-P1** |
| Turn-interruption detection → continuation marker | `conversationRecovery.ts:272-333` `detectTurnInterruption()` 3-way classification (none / interrupted_prompt / interrupted_turn); interrupted_turn gets a synthetic isMeta `"Continue from where you left off."` user message (`conversationRecovery.ts:210-221`). | Absent. Nearest: `local-chat-transport.ts:183-189` marks the last assistant message `metadata.isInterrupted` on abort (rendered by `components/messages/interrupted-message.tsx`), but nothing happens on resume. | **ADOPT-P1** |
| Tombstones for orphaned partial messages on streaming fallback | `query.ts:712-741`: when a streaming fallback fires mid-response, already-yielded partial assistant messages are tombstoned (`{type:'tombstone', message}`) so UI and transcript drop them (invalid thinking signatures would 400 on replay). | Absent — no fallback model concept (nearest: single-model resolution, `local-chat-transport.ts:87-89`). | **LATER** — only needed once fallback models exist (see §7). |
| Thinking-signature stripping before model switch | `query.ts:927-929` `stripSignatureBlocks` before retrying on the fallback model. | Absent / N-A — OpenRouter reasoning parts (handled by `toUIMessageStream`, `local-chat-transport.ts:155`) carry no provider-bound signatures. | **SKIP** — Anthropic-specific thinking-signature contract. |
| API-error assistant messages excluded from "completed turn" detection | `conversationRecovery.ts:284-289`: error assistants skipped when finding the last turn-relevant message so auto-resume still fires after retry exhaustion. | Absent (error rows dropped wholesale at `conversation.ts:111`, which loses the information instead). | **ADOPT-P1** |
| Resume consistency checks / chain-walked jsonl transcripts | `conversationRecovery.ts:416-440` `loadMessagesFromJsonlPath` (parentUuid chain walk, leaf selection), `sessionStorage` lite logs. | Absent — knightcode stores ordered rows in sqlite (`store/conversation.ts:99`), no parent chains. | **SKIP** — store keeps UIMessage rows by decision (spec "Store keeps the UIMessage format"). |

## 3. Tool orchestration (concurrency safety, scheduling, permission flow)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| `isConcurrencySafe(input)` per tool, fail-closed default | `Tool.ts:402` contract method; `Tool.ts:757-769` `TOOL_DEFAULTS.isConcurrencySafe = () => false`. Input-dependent (e.g. Bash parses the command; a throw is treated as unsafe — `toolOrchestration.ts:99-107`). | Absent — tool contracts (`@repo/shared` `getToolContracts`, consumed at `local-chat-transport.ts:80`) have no concurrency flag; everything runs as the model emits it, serialized through React state. | **ADOPT-P2** |
| Batch partitioning: contiguous safe calls parallel, unsafe serial | `toolOrchestration.ts:91-116` `partitionToolCalls`, `toolOrchestration.ts:19-82` `runTools` — concurrent batches via `all(generators, concurrency)` capped by `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` default 10 (`toolOrchestration.ts:8-12`). | Absent. `use-chat.ts:884-914` fires `executeLocalTool` per `onToolCall` callback; effective ordering is whatever React scheduling gives. | **ADOPT-P2** |
| Streaming tool execution (start tools while the response is still streaming) | `StreamingToolExecutor.ts:40` — `addTool()` as each tool_use block arrives (`query.ts:841-844`), results interleaved into the stream (`query.ts:851-862`), ordered emission (`StreamingToolExecutor.ts:412-440`), gated by `config.gates.streamingToolExecution` (`query.ts:561`). | Absent (nearest: per-callback execution after the stream delivers each call, `use-chat.ts:884-914`). | **LATER** — Phase 2 builds the post-stream scheduler (`runTools` model); the streaming variant is an optimization on top. |
| Bash error cancels parallel siblings | `StreamingToolExecutor.ts:354-364`: only Bash errors set `hasErrored` and abort the sibling controller; cancelled siblings get `"Cancelled: parallel tool call X errored"` synthetic results (`StreamingToolExecutor.ts:189-205`). | Absent (nearest: independent per-call error handling, `use-chat.ts:907-914`) — and moot in P2's table since Bash is never parallelized. | **SKIP** — knightcode serializes Bash (unsafe), so the sibling-cancel case cannot arise. |
| Per-tool `interruptBehavior(): 'cancel' \| 'block'` | `Tool.ts:416`; consulted on submit-interrupt (`StreamingToolExecutor.ts:222-229`) to decide whether a queued user message kills the tool. | Absent — abort stops scheduling, in-flight tools run to completion (and the spec keeps that contract). | **LATER** |
| Every execution path yields a tool_result (unknown tool, zod failure, validateInput failure, abort, deny, throw) | `toolExecution.ts:369-411` (unknown tool), `:615-680` (zod + `buildSchemaNotSentHint` `:578-597` for deferred tools), `:683-733` (validateInput), `:415-453` (pre-aborted → CANCEL_MESSAGE), `:995-1104` (permission denied), `runToolUse` catch `:469-489` (throw → `<tool_use_error>`). | Partial: `executeLocalTool` throws on unknown tool / mode mismatch / hook block (`tools/index.ts:108-144`) and the *caller* converts to `addToolOutput({state:"output-error"})` (`use-chat.ts:161-167,907-914`) — enforcement is at every call site, not in one executor. Subagent path does its own (`run-subagent.ts:87-91`). | **ADOPT-P2** (scheduler-enforced per spec §Error handling) |
| Async `canUseTool` permission callback with `allow/deny`, `updatedInput`, decision reasons | `toolExecution.ts:921-931` → `toolHooks.ts:332` `resolveHookPermissionDecision`; result can rewrite input (`toolExecution.ts:1130-1132`); deny becomes an error tool_result with the message (`toolExecution.ts:1023-1071`). | React-state interception: `use-chat.ts:812-882` pushes `pendingConfirmations`; `confirmToolCall` (`use-chat.ts:173-267`) executes or emits `"User declined this change. Guidance: …"` (`use-chat.ts:254-262`). Promise-based variant exists only for subagent bubbling (`use-chat.ts:121-134`). | **ADOPT-P2** |
| Rule-based permission engine (allow/deny/ask rules, modes, classifier) | `toolExecution.ts:918` permission mode from app state; `checkRuleBasedPermissions` overrides hook allows (`toolHooks.ts:373-405`); persisted rule sources (`Tool.ts:123-138` ToolPermissionContext). | Simpler injected policy: AUTO short-circuit (`use-chat.ts:818,834,863,876`), Bash allowlist via `permissions.json` (`isCommandAllowed`/`allowCommand`, `use-chat.ts:198-202,833`), session `alwaysAllowEdits` (`use-chat.ts:197-244`), Config read/write split (`use-chat.ts:860-874`). | **ADOPT-P2** — port knightcode's existing semantics into engine policy (per spec); claude-code's full rule grammar is **LATER**. |
| `validateInput()` / zod parse before permissions | `toolExecution.ts:615,683`. | Each executor parses its own input (e.g. `Agent/execute.ts:43` `Agent.input_schema.parse`); a parse throw becomes output-error at the call site. | **ADOPT-P2** (scheduler runs schema parse centrally so failures are uniform error tool_results) |
| Loop protection (repeated identical calls) | Absent in claude-code (closest analog: token-budget diminishing-returns stop, `query/tokenBudget.ts:59-62`). | `use-chat.ts:772-785`: per-turn `Map<toolName:inputJSON,count>`, >8 identical → error output, TodoWrite exempt; cleared per submit (`use-chat.ts:1000`). | **ADOPT-P2** (keep — knightcode-specific guard, moves into engine State) |
| `contextModifier` on tool results (tools rewriting the context for later tools) | `Tool.ts:330`; honored only for non-concurrency-safe tools (`toolOrchestration.ts:140-147`, `StreamingToolExecutor.ts:391-395`). | Absent — knightcode tools have no context-modification channel (mode transitions ride on the output object, `use-chat.ts:149-154`). | **ADOPT-P2** (only the mode-transition slice, as the spec's `mode_change` State update; general contextModifier is **LATER**) |

## 4. Hook system (events, blocking, systemMessage channels)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| PreToolUse: block / allow / ask / updatedInput / additionalContext | `toolHooks.ts:435` `runPreToolUseHooks` yields typed results — `hookPermissionResult` (`:486-553`), passthrough `hookUpdatedInput` (`:556-563`), `additionalContext` attachments (`:565-579`), `preventContinuation` (`:499-507`); hook allow still subject to deny/ask rules (`toolHooks.ts:373-405`). | `lib/hooks.ts:266-304` `runPreToolHooks`: block + reason + systemMessage only. Block makes `executeLocalTool` **throw** (`tools/index.ts:137-144`) → caller renders output-error. No updatedInput, no ask, no additionalContext. The returned `systemMessage` is ignored by `tools/index.ts`. | **ADOPT-P2** (scheduler converts block→error tool_result; systemMessage carried forward — updatedInput/ask are **LATER**) |
| PostToolUse: blocking errors, additional context, MCP output rewrite | `toolHooks.ts:39-191` `runPostToolUseHooks` — `hook_blocking_error` attachments feed back to the model, `additionalContexts` injected, `updatedMCPToolOutput` (`:146-151`). | `lib/hooks.ts:306-323` `runPostToolHooks` returns `void` — fired as `void runPostToolHooks(...)` (`tools/index.ts:159`), so even a hook's `systemMessage` (`hooks.ts:43`) is silently dropped. | **ADOPT-P2** (collect systemMessages → next-round system-reminder per spec; blocking PostToolUse is **LATER**) |
| PostToolUseFailure | `toolHooks.ts:193-319`. | `lib/hooks.ts:325-342`, fired on executor throw (`tools/index.ts:150-156`). Equivalent shape, void result. | **ADOPT-P2** (keep; owned by scheduler) |
| Stop hooks: blocking errors continue the loop; `stop_hook_active` re-entrancy flag | `query/stopHooks.ts:65` `handleStopHooks` — blocking errors become isMeta user messages and the loop continues with `transition:'stop_hook_blocking'` (`query.ts:1282-1306`); `preventContinuation` ends the turn (`query.ts:1278-1280`); `stopHookActive` passed to hooks (`stopHooks.ts:184`); skipped entirely when the last message is an API error to avoid death spirals (`query.ts:1258-1265`); summary system message (`stopHooks.ts:297-309`). | `lib/hooks.ts:392-407` `runStopHooks` — fire-and-forget from a `setTimeout` in `onFinish` (`use-chat.ts:918-923`); has the `stop_hook_active` re-entrancy set (`hooks.ts:390-401`) but no blocking, no continuation, output discarded. | **ADOPT-P2** (engine fires on `turn_complete`; blocking-continue semantics **LATER** — knightcode's hook output schema has `continue:false` but no model-visible block channel yet) |
| UserPromptSubmit blocking | Handled outside query() in claude-code's input pipeline (`processUserInput`, referenced `QueryEngine.ts:69-71`). | `use-chat.ts:982-998`: hook runs before `sendMessage`, block → toast. Stays in `useQueryEngine` per spec. | **ADOPT-P2** (keep as-is, relocated) |
| Other hook events (SessionStart, PreCompact/PostCompact, PermissionRequest, PermissionDenied, Notification, TeammateIdle, TaskCompleted, SubagentStop, post-sampling) | `conversationRecovery.ts:565` (SessionStart on resume), `compact.ts:406-409` (pre_compact), `toolExecution.ts:979-993` (PermissionRequest), `toolExecution.ts:1073-1101` (PermissionDenied), `stopHooks.ts:334-453` (teammate/task hooks), `query.ts:999-1009` (post-sampling). | Absent — knightcode has exactly 5 events (`lib/hooks.ts:7-12`). | **LATER** (PreCompact/SessionStart are natural Phase-4+ additions); Teammate/TaskCompleted **SKIP** — no teams feature. |
| Hook progress messages rendered in transcript | Hooks yield `progress`/attachment messages into the stream (`toolHooks.ts:79-87`, `stopHooks.ts:200-215`). | Absent — hook execution is invisible in the UI (hooks run silently in `tools/index.ts:137-159`). | **LATER** |

## 5. Context assembly (system prompt, attachments, caching, deferred tools)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Per-turn attachment injection between tool rounds | `utils/attachments.ts:2937` `getAttachmentMessages` / `:743` `getAttachments`, called after each tool round (`query.ts:1580-1590`): changed-file diffs (`attachments.ts:2063` `getChangedFiles`), nested CLAUDE.md (`:1710` `memoryFilesToAttachments`), todo reminders (`:254`), plan/auto-mode reminders (`:259,264`), date change (`:1415`), deferred-tools delta (`:1455`), agent-listing delta (`:1490`), queued commands (`:1046`). Attachments append to `toolResults` so the next round sees them. | Absent. All context rides in the system prompt rebuilt per POST (`local-chat-transport.ts:116-133` via `buildSystemPrompt`); nothing is injected mid-turn between rounds. | **ADOPT-P3** (the hook systemMessage reminder channel lands in P2; a general attachment pipe is the P3 context work; full attachment taxonomy **LATER**) |
| Static/volatile context split with caching | System prompt rendered once and frozen for cache-sharing (`Tool.ts:294-299` `renderedSystemPrompt`); `userContext`/`systemContext` passed as stable params (`query.ts:181-199`) and appended via `prependUserContext`/`appendSystemContext` (`query.ts:659-661,449-451`) rather than rebuilt. | Static slice memoized (`lib/inference/build-request-context.ts:35`, invalidation `:59`); volatile slice (git branch/status/diff via spawned git, task scan) recomputed every tool round (`build-request-context.ts:71-80`, called per POST at `local-chat-transport.ts:71`). | **ADOPT-P3** (cache volatile slice per user turn; invalidate on git-mutating Bash) |
| Incremental transcript→API conversion | `query.ts:365` slices from last compact boundary; the messages array flows forward through State — no re-validation of history per round. | Full `validateUIMessages` + `convertToModelMessages` of the entire transcript on every round (`local-chat-transport.ts:96-102`). | **ADOPT-P3** |
| Deferred tools / ToolSearch | `Tool.ts:442` `shouldDefer`, `:449` `alwaysLoad`; discovered set derived from history `extractDiscoveredToolNames` (`toolExecution.ts:590`); schema-not-sent hint on zod failure (`toolExecution.ts:578-597`); deferred-tools delta attachment (`attachments.ts:1455`). | Exists: `extractLoadedDeferredTools(messages)` rescans history every round (`local-chat-transport.ts:76`), unloaded set announced via system prompt (`local-chat-transport.ts:83-85,131`). | **ADOPT-P1/P3** — spec puts loaded-deferred-tools into engine State (P1 State shape, P3 stops the rescan). |
| Prompt caching discipline (never mutate API-bound blocks) | `query.ts:744-746`: yield a *clone* with backfilled input, keep the original byte-identical for the next request; `skipCacheWrite` param (`query.ts:192`). | N-A today (OpenRouter/AI SDK manages provider caching; knightcode doesn't mutate sent messages mid-turn except compaction — which §6 fixes). | **ADOPT-P3** as a design rule for the engine (request-view projections never mutate persisted/stream objects). |
| Memory prefetch overlapped with streaming | `attachments.ts:2361` `startRelevantMemoryPrefetch` fired once per turn (`query.ts:301-304`), consumed zero-wait post-tools (`query.ts:1592-1614`); skill-discovery prefetch per iteration (`query.ts:331-335,1620-1628`). | Absent — no memory/skill-discovery side-model (nearest: synchronous context build, `build-request-context.ts:71-80`). | **SKIP** — depends on side-model infrastructure knightcode doesn't have; revisit if a memory feature lands. |
| MCP tool refresh between rounds | `query.ts:1659-1671` `refreshTools()`. | Absent — no MCP (tool set fixed per request, `local-chat-transport.ts:80-85`). | **SKIP** — no MCP support in knightcode (LATER as part of any future MCP feature, not the harness). |

## 6. Compaction stack (microcompact, autocompact, boundaries, snip)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Ordering: budget → snip → microcompact → collapse → autocompact, every round, inside the loop | `query.ts:379-394` (tool-result budget) → `:401-410` (snip) → `:413-426` (microcompact) → `:440-447` (collapse) → `:453-467` (autocompact), all before the API call each iteration. | Compaction runs *outside* the loop: once per `onFinish` (`use-chat.ts:917`) and once before submit (`use-chat.ts:1004`) — never between tool rounds, so a long agentic turn can blow context mid-turn. | **ADOPT-P4** |
| Microcompact: clear old tool outputs by tool_use_id, request-view only | `services/compact/microCompact.ts:253` `microcompactMessages`; compactable tool whitelist (`microCompact.ts:41-50`: Read/Bash/Grep/Glob/WebSearch/WebFetch/Edit/Write); cached-MC path edits the *API cache*, local messages untouched (`microCompact.ts:305-399`, "Return messages unchanged" `:369`); time-based path content-clears all but last N with `[Old tool result content cleared]` (`microCompact.ts:446-530`, marker `:36`). | Destructive: `use-chat.ts:429-614` naive pass rewrites persisted parts to `[Tool Output Cleared: N lines]` (`use-chat.ts:579,598-599`) and writes them back via `replaceSessionMessages` (`use-chat.ts:675-679`). | **ADOPT-P4** (request-view microcompact; keep knightcode heuristics — last-5-files `use-chat.ts:431-477`, failed-Bash preserve `:561-566`, search-turn collapse `:488-537` — made non-destructive) |
| Cached microcompact via API cache-editing (`cache_edits` blocks) | `microCompact.ts:276-292` + `cachedMicrocompactPath`; deferred boundary uses API-reported `cache_deleted_input_tokens` (`query.ts:870-892`). | Absent (nearest microcompact analog: the destructive naive pass, `use-chat.ts:429-614`). | **SKIP** — requires Anthropic's cache-editing beta; OpenRouter BYOK has no equivalent. |
| Autocompact: threshold = contextWindow − 20k summary reserve − 13k buffer | `autoCompact.ts:33-49` `getEffectiveContextWindowSize`, `:62` `AUTOCOMPACT_BUFFER_TOKENS = 13_000`, `:72-91` threshold, `:93-145` warning/error/blocking states, `:147-158` enable toggles, `:160-239` `shouldAutoCompact` with recursion guards. | Crude threshold: `lastUsage.inputTokens < 0.8 * contextWindow` skip, else compact; fallback heuristic "more than 35 messages" (`use-chat.ts:354-368`). | **ADOPT-P4** |
| Autocompact circuit breaker (consecutive-failure cap) | `autoCompact.ts:70` `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`, checked `:257-265`, failure count threaded through State tracking (`query.ts:536-543`). | Absent — `isCompactingRef` only prevents overlap (`use-chat.ts:343-344`); a failing summarizer falls to naive compaction every time (`use-chat.ts:422-427`). | **ADOPT-P4** |
| Compact boundary message model (non-destructive) | `messages.ts:4530` `createCompactBoundaryMessage` (system msg, `subtype:'compact_boundary'`, `compactMetadata`); `:4643` `getMessagesAfterCompactBoundary` slices the request view; full pre-compact history stays in the REPL array/scrollback. Post-compact array = boundary + summary + messagesToKeep + attachments + hookResults (`compact.ts:330-338` `buildPostCompactMessages`, result shape `:299-310`). Boundary yielded into the stream (`query.ts:530-535`). | Destructive replace: summary message + last-4 tail *replace* the transcript (`compact-conversation.ts:153-166`), then `replaceSessionMessages` permanently deletes original rows (`use-chat.ts:408-412`). UI renders the summary row via `components/messages/compaction-message.tsx`. | **ADOPT-P4** (boundary + `compaction_boundary` event; reuse `compact-conversation.ts` summarizer) |
| Post-compact context restoration (file attachments, plan, skills) | `compact.ts:1415` `createPostCompactFileAttachments`, `:1470` plan, `:1494` skills, `:1542` plan-mode, `:1568` async-agent attachments — re-prime the post-compact context. | Absent — only the LLM summary text carries state (the prompt asks for file lists, `compact-conversation.ts:29-32`). | **LATER** — good Phase-4 follow-up once attachments exist (P3). |
| Post-compaction usage re-estimate for status bar | `compactionResult.postCompactTokenCount/truePostCompactTokenCount` (`query.ts:470-476`); usage events logged. | Exists: `compact-conversation.ts:171-183` rewrites last assistant `metadata.usage` to the estimate (and naive path `use-chat.ts:619-641`). | **ADOPT-P4** (keep; spec §Post-compaction usage) |
| Summarizer-history grouping at API-round boundaries | `services/compact/grouping.ts:22` `groupMessagesByApiRound` (assistant message.id boundaries; used by reactive compact to pick a split point). | Absent — fixed `slice(0,-4)` split (`compact-conversation.ts:121-124`). | **ADOPT-P4** (pick split points at round boundaries instead of a fixed tail length) |
| Session-memory compaction (tried before summary compaction) | `autoCompact.ts:288-310` `trySessionMemoryCompaction`, `services/compact/sessionMemoryCompact.ts`. | Absent — only LLM-summary compaction exists (`compact-conversation.ts:101`). | **SKIP** — depends on the session-memory subsystem knightcode doesn't have. |
| History snip (drop verbose mid-history segments with a boundary) | `query.ts:401-410` + `services/compact/snipCompact.ts` (feature-gated `HISTORY_SNIP`); freed tokens plumbed into autocompact's threshold check (`query.ts:396-399,638`). | Absent (nearest: search-turn collapse in the naive compactor, `use-chat.ts:488-537`). | **LATER** |
| Context collapse (read-time projection w/ commit log) | `query.ts:440-447`, `services/contextCollapse/` (ant-only experiment). | Absent (the engine's request-view projection at `use-chat.ts:429-614`'s successor covers the need). | **SKIP** — experimental, redundant with microcompact+autocompact for knightcode's scale. |
| PTL-retry head truncation inside the compaction fork | `compact.ts:227-291` `truncateHeadForPTLRetry` (summarizer itself overflows → truncate head, retry, max 3). | Absent — summarizer failure falls straight to naive compaction (`use-chat.ts:422-427`). | **LATER** (keep naive fallback as the P4 answer) |

## 7. Recovery paths (retries, fallback model, reactive compaction, token budgets)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Stream-error retry with backoff | `services/api/withRetry.ts` — `DEFAULT_MAX_RETRIES = 10` (`withRetry.ts:52`), `getRetryDelay` exponential + Retry-After (`withRetry.ts:530`), countdown system messages (`withRetry.ts:509` via `messages.ts:4585` `createSystemAPIErrorMessage`). Lives below `query()` in the API layer. | Absent — any stream error surfaces once via `onError` (`local-chat-transport.ts:195-196`) and the turn dies; useChat's `error` is shown raw (`use-chat.ts:962`). | **ADOPT-P4** (`engine/recovery.ts`, bounded attempts + `retry` event) |
| Fallback model on overload | `FallbackTriggeredError` caught in-loop (`query.ts:893-952`): switch `currentModel`, clear partial state, synthesize missing tool_results, warn the user, retry; streaming-fallback tombstone path (`query.ts:712-741`). | Absent — single model per turn (`local-chat-transport.ts:87-89` `resolveModel`). | **LATER** — OpenRouter already routes across providers; an explicit fallback-model chain is backlog. |
| Withhold-then-recover for recoverable errors | `query.ts:799-825`: prompt-too-long / media-size / max_output_tokens errors are *withheld* from the stream until recovery is attempted, so consumers never see transient errors (`query.ts:166-179` rationale). | Absent — errors surface immediately via `onError` (`local-chat-transport.ts:195-196`). | **ADOPT-P4** (engine-internal: don't emit `error` events for errors it's about to retry) |
| Reactive compaction on context-overflow rejection | `query.ts:1119-1175`: withheld 413 → `tryReactiveCompact` → continue with `transition:'reactive_compact_retry'`; single-shot guard `hasAttemptedReactiveCompact` (`query.ts:209,1157`), guard *preserved* across stop-hook continues to avoid infinite compact loops (`query.ts:1292-1297`). | Absent — a context-overflow rejection from OpenRouter just errors the turn. Proactive-only compaction (`use-chat.ts:917,1004`). | **ADOPT-P4** |
| max_output_tokens recovery: escalate cap, then meta-nudge resume (max 3) | `query.ts:1188-1256`: first retry same request at `ESCALATED_MAX_TOKENS`; then inject isMeta user message "Output token limit hit. Resume directly…" up to `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3` (`query.ts:164`). | Absent — a length-stop just ends the turn (nearest: finish handling in `local-chat-transport.ts:159-167`). | **ADOPT-P4** (the meta-nudge resume; the 8k→64k escalation is Anthropic-cap-specific — **SKIP** that half) |
| Empty/malformed response retry | Covered by withRetry's API-layer classification (`withRetry.ts:550` parse helpers) plus the loop never crashing on empty assistant lists. | Absent — an empty response leaves an empty assistant shell, filtered later (`local-chat-transport.ts:93-95`, `conversation.ts:109-113`) rather than retried. | **ADOPT-P4** (spec: retry once, then surface) |
| Blocking limit preempt when autocompact is off | `query.ts:592-648`: synthetic `PROMPT_TOO_LONG_ERROR_MESSAGE` before the API call, reserving room for manual `/compact`; skipped when any automatic recovery owns the problem. | Absent (nearest: the pre-submit 0.8-of-window compact check, `use-chat.ts:354-368`). | **ADOPT-P4** |
| Token-budget auto-continue (+nudge) and diminishing-returns stop | `query/tokenBudget.ts:45` `checkTokenBudget` — continue below 90% of budget (`tokenBudget.ts:3`), stop when <500-token deltas twice (`:4,59-62`); wired at `query.ts:1308-1355`. | Absent (nearest cap concept: subagent `maxTurns`, `Agent/execute.ts:67`). | **LATER** — useful for background agents; not in the 6 phases. |
| API `task_budget` carryover across compactions | `query.ts:193-197,285-291,508-515,1138-1146`. | Absent (no equivalent API param via OpenRouter, `local-chat-transport.ts:114-153`). | **SKIP** — Anthropic beta API parameter; no OpenRouter equivalent. |
| Image-size/resize error handling | `query.ts:969-978` (`ImageSizeError`/`ImageResizeError` → friendly assistant error); media-size reactive strip-retry (`query.ts:1082-1084`). | Absent — knightcode sends no images (text-only submit, `use-chat.ts:1005-1016`). | **SKIP** — no image-input feature. |

## 8. Subagents (recursive query, streaming, parallelism, model resolution)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Subagents run the same `query()` generator | AgentTool calls `query()` with a subagent `ToolUseContext` (`Tool.ts:245` `agentId`, `:246` `agentType`); query tracking depth/chain (`query.ts:347-363`); same compaction/recovery/hooks apply inside the subagent. | Bespoke mini-loop `Agent/run-subagent.ts:45-108`: hand-rolled message array, no compaction, no hooks-on-results, no recovery; tools strictly serial (`run-subagent.ts:79-104`). | **ADOPT-P5** (delete `run-subagent.ts`, recurse `query()`) |
| Streaming subagent progress to the parent UI | Subagent messages flow as `progress` messages tagged with `agentId`/`parentToolUseID` (`toolExecution.ts:549-556`, `Tool.ts:50` `AgentToolProgress`); REPL renders nested live activity. | Invisible: subagent uses **`generateText`** (non-streaming, `Agent/execute.ts:78`); the user sees nothing until the Agent tool returns its final text. | **ADOPT-P5** (engine events bubble tagged with `agentId`) |
| Parallel subagents | Agent is concurrency-safe, so the scheduler runs parallel Agent calls (cap 10, `toolOrchestration.ts:8-12`). | Sequential: foreground Agent goes through `pendingConfirmations` and `confirmToolCall` *awaits the whole subagent run* inside the confirm handler (`use-chat.ts:173-267` → `executeAndOutput` `use-chat.ts:136-171`). | **ADOPT-P2/P5** (P2 makes Agent schedulable-parallel; P5 makes the inner loop the engine) |
| Parent-mode + shared permission policy inheritance | Subagent context inherits the parent's permission context (`Tool.ts:123-138`); `shouldAvoidPermissionPrompts` for background agents (`Tool.ts:133`); `localDenialTracking` for async agents (`Tool.ts:283`). | Mode hardcoded `"BUILD"` regardless of parent (`Agent/execute.ts:66`); duplicated gating list minus Config/Agent (`Agent/execute.ts:23-28`); background agents auto-deny via `requestPermission: async () => false` (`Agent/execute.ts:120`). | **ADOPT-P5** (shared injected policy; keep background auto-deny) |
| Subagent model resolution / per-spawn override | Model rides in agent definitions + runtime model resolution (`query.ts:572-578` `getRuntimeMainLoopModel`). | Exists: `resolveSubagentModel({override, aliasArg, agentModel})` (`Agent/execute.ts:61-65`), user override via `setConfirmationModelOverride` (`use-chat.ts:269-278`). | **ADOPT-P5** (keep; override travels as permission `updatedInput` per spec) |
| Depth limiting / no recursive Agent | knightcode strips Agent from subagent toolsets (`Agent/execute.ts:58-60`); claude-code governs via `allowedAgentTypes` (`query.ts:683-684`) and query depth tracking (`query.ts:347-355`). | See left — already prevents nesting. | **ADOPT-P5** (explicit depth limit in engine params) |
| Background-agent completion re-entry via notification queue | claude-code: process-global message queue, agent-scoped drain in-loop (`query.ts:1547-1578`). | Exists: `Agent/notifications.ts` FIFO + idle-tick drain (`use-chat.ts:943-950` — one per idle tick, never during stream/prompt). | **ADOPT-P5** (keep knightcode semantics; engine stays notification-agnostic per spec) |
| Forked agents sharing parent prompt-cache bytes | `Tool.ts:294-299` `renderedSystemPrompt`, `forkedAgent.ts` cacheSafeParams (`stopHooks.ts:96-98`). | Absent — subagent system prompt rebuilt per spawn (`Agent/execute.ts:111,169` `agent.getSystemPrompt()`). | **SKIP** — Anthropic prompt-cache-sharing optimization; OpenRouter BYOK can't exploit it. |

## 9. Truncation & result-size budgets

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Per-tool `maxResultSizeChars` with disk spill | `Tool.ts:466` — oversized results persisted to disk, model gets preview + file path; `Infinity` for Read (self-bounding). | Absent — no per-tool budget field on contracts (contracts consumed at `local-chat-transport.ts:80`; only blanket constants in `lib/tools/shared/constants.ts:4-7`). | **ADOPT-P6** (the budget field; disk-spill is **LATER** — start with elide-with-hint) |
| Aggregate tool-result budget at transcript-assembly time | `query.ts:379-394` `applyToolResultBudget` over `messagesForQuery` each round, replacement records persisted for resume (`recordContentReplacement`), tools without finite budgets exempted (`query.ts:389-393`); composes with microcompact (runs before, by tool_use_id). | Absent — truncation happens only at execution time inside each tool (`Bash/execute.ts:66-67`), never at assembly. | **ADOPT-P6** |
| Head+tail middle truncation with retrieval hint | Tool-level truncation previews keep usable head/tail and point at the persisted file (`Tool.ts:458-465` doc). | Tail-chop only: `truncate(stdout, MAX_BASH_OUTPUT)` with `MAX_BASH_OUTPUT = 50_000` chars (`lib/tools/Bash/execute.ts:66-67`, `lib/tools/shared/constants.ts:4`); `DEFAULT_READ_LIMIT = 200` lines (`constants.ts:7`, `Read/execute.ts:53`). No elision marker telling the model how to get more. | **ADOPT-P6** (`… [N lines elided — re-run with offset/limit …]` per spec) |
| `isResultTruncated` UI affordance | `Tool.ts:615` — gates click-to-expand only where verbose actually shows more. | Absent (generic `tool-call-view.tsx` truncates display uniformly). | **ADOPT-P6** (with the per-tool renderers) |

## 10. Queueing & turn lifecycle (queued messages, stop hooks, timing)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Mid-turn queued-message drain as attachments | Process-global queue (`utils/messageQueueManager.ts`); per-round drain with priority (`'next'` vs `'later'` depending on Sleep, `query.ts:1566-1578`), slash commands excluded, agent-scoped addressing; consumed commands get lifecycle `started`/`completed` notifications (`query.ts:229-238,1632-1643`); rendered while queued via `context/QueuedMessageContext.tsx:20` `QueuedMessageProvider`. | Absent for user prompts — typing during a stream isn't queued into the current turn. Only background-agent notifications queue (`Agent/notifications.ts`) and drain on idle (`use-chat.ts:943-950`). | **LATER** — spec keeps notification drain (P5) but mid-turn user-prompt queueing isn't in the 6 phases. |
| Submit-interrupt (queued message aborts the stream, skips the interruption marker) | Abort reason `'interrupt'` suppresses the `[Request interrupted by user]` message (`query.ts:1046-1050,1499-1505`); tools consulted via `interruptBehavior` (`StreamingToolExecutor.ts:222-229`). | Absent — `submit` is unavailable mid-stream; `abort: chat.stop` (`use-chat.ts:1018`) is a plain abort. | **LATER** |
| Stop hooks at turn end (see §4) | `query.ts:1267-1306`. | `use-chat.ts:918-923` setTimeout. | **ADOPT-P2** (engine `turn_complete` → `runStopHooks`) |
| Turn timing anchored to submit, pausing while awaiting the user | knightcode-originated pattern; claude-code tracks blocked-on-user spans via telemetry (`toolExecution.ts:914,998` `startToolBlockedOnUserSpan`/`endToolBlockedOnUserSpan`). | Exists and good: `submittedAt` metadata (`use-chat.ts:1011`), pause accumulator on pending confirmations (`use-chat.ts:931-938`, `local-chat-transport.ts:109-111,160-166`). | **ADOPT-P1** (port `turnPausedMsRef` into engine State per spec; `turn_complete.durationMs`) |
| Accumulated per-turn usage | Usage accumulated across rounds (`QueryEngine.ts:189` `totalUsage`, `accumulateUsage` import `QueryEngine.ts:17`). | Exists per-POST: `onStepFinish` accumulation (`local-chat-transport.ts:138-152`) — but resets every tool round since each round is a fresh POST. | **ADOPT-P1** (sum across rounds in State; emit in `turn_complete`) |
| Tool-use summary generation overlapped with next stream | `query.ts:1411-1482`: Haiku summary of the tool batch fired async, yielded next iteration (`query.ts:1054-1060`). | Absent (tool rows render raw output, `components/messages/tool-call-view.tsx:35`). | **SKIP** — feeds Anthropic's mobile/headless surfaces; no knightcode consumer. |
| `/clear` and `/rewind` turn-pair surgery | claude-code uses message-selector + session forking (`QueryEngine.ts:85-89` lazy MessageSelector). | Exists: `clearMessages` (`use-chat.ts:691-699`), `rewindMessages` walking user/assistant pairs (`use-chat.ts:701-764`). | **ADOPT-P1** (preserve semantics via `useQueryEngine.clear()/rewind(n)` per spec) |

## 11. Tool/UI rendering (per-tool renderers, grouping, progress)

| Mechanism | claude-code | knightcode today | Verdict |
|---|---|---|---|
| Per-tool render methods on the contract | `Tool.ts:566` `renderToolResultMessage`, `:605` `renderToolUseMessage`, `:621` `renderToolUseTag`, `:625` `renderToolUseProgressMessage`, `:635` `renderToolUseQueuedMessage`, `:641` `renderToolUseRejectedMessage`, `:659` `renderToolUseErrorMessage`. | One generic `components/messages/tool-call-view.tsx:35` for all tools; diff components exist (`components/messages/diff-view.tsx:21`, `diff-body.tsx`) but only permission dialogs use them (`tool-permission-request.tsx`). | **ADOPT-P6** |
| Grouped/collapsed read & search rendering | `Tool.ts:678` `renderGroupedToolUse` (parallel instances as one block); `Tool.ts:429` `isSearchOrReadCommand` drives condensed display. | Absent — every call renders its own row (`tool-call-view.tsx:35`). | **ADOPT-P6** |
| Exit-code-aware Bash output blocks | Bash renderer distinguishes exit codes / stderr (BashTool render methods; contract surface `Tool.ts:566-599`). | Generic output dump in `tool-call-view.tsx:35`. | **ADOPT-P6** |
| Live progress messages per tool (spinners, partial output) | `Tool.ts:305-340` Progress/ToolProgress types; progress streamed through `runToolUse` (`toolExecution.ts:549-556`) and yielded immediately even while other tools run (`StreamingToolExecutor.ts:366-374,418-421`). | Absent — a running tool shows a static row until output lands; `components/working-indicator.tsx:53` is global, not per-tool. | **ADOPT-P2** (concurrent rows + spinners land with the scheduler) / **ADOPT-P6** (rich per-tool progress) |
| Live nested subagent activity | AgentToolProgress (`Tool.ts:50`) rendered as nested lines under the Agent row. | Absent (see §8 — `generateText` at `Agent/execute.ts:78` hides everything). | **ADOPT-P5** |
| Retry/compaction system rows | `createSystemAPIErrorMessage` (`messages.ts:4585`) retry countdown rows; compact boundary rendered as a system row (`messages.ts:4530`). | Compaction summary row exists (`components/messages/compaction-message.tsx:12`); no retry rows (no retries). | **ADOPT-P4** (UI lockstep for recovery/boundary events) |
| Interrupted-turn marker | `createUserInterruptionMessage` (`query.ts:1047,1502`). | Exists: `metadata.isInterrupted` (`local-chat-transport.ts:183-189`) + `components/messages/interrupted-message.tsx:24`. | **ADOPT-P1** (emit from engine repair/abort path instead of transport heuristic) |
| Transcript search text extraction (`extractSearchText`) | `Tool.ts:599`. | Absent — no transcript search feature (transcript rendering: `components/messages/index.tsx`). | **SKIP** — feature doesn't exist in knightcode. |
| `userFacingName` / `getActivityDescription` spinner strings | `Tool.ts:524,546`. | Absent — tool name shown raw (`tool-call-view.tsx:35`). | **ADOPT-P6** (cheap, part of renderer work) |

## 12. Out of scope in claude-code (all SKIP)

All marked **SKIP** — unrelated to the harness, per spec "Out of scope":

- **Voice / dictation** (`hooks/useVoiceInput` etc.) — no audio surface in knightcode.
- **IDE bridge** (`services/ide/`, `sse-ide`/`ws-ide` MCP transports — `toolExecution.ts:272-281`) — terminal-only product.
- **Swarms / teams / teammates / coordinator mode** (`stopHooks.ts:334-453` TeammateIdle/TaskCompleted hooks, `QueryEngine.ts:110-118` coordinator context, `Tool.ts:277` in-process teammates) — no multi-agent team feature.
- **Remote / teleport / background daemon sessions** (`conversationRecovery.ts:134-137` TeleportRemoteResponse, `BG_SESSIONS` gates `query.ts:118-120,1685-1702`, `claude ps` task summaries) — local-only CLI.
- **Computer use / chicago MCP** (`query.ts:1033-1042,1489-1498`).
- **MCP client stack** (`services/mcp/`, `Tool.ts:436,455` isMcp/mcpInfo, elicitation `Tool.ts:198-202`) — knightcode has no MCP; if added later it's a feature, not harness work.
- **Analytics/telemetry/GrowthBook** (`logEvent`/`logOTelEvent` throughout, `getFeatureValue_CACHED_MAY_BE_STALE` `query.ts:1195`) — knightcode ships none.
- **Jobs/templates classifier** (`query.ts:69-71`, `stopHooks.ts:108-132`), **memory extraction / auto-dream / prompt suggestion** (`stopHooks.ts:136-157`), **session-memory** (`autoCompact.ts:288`), **skill-search side-model prefetch** (`query.ts:66-68`).
- **Anthropic API betas**: task_budget (`query.ts:193-197`), cache-editing microcompact (§6), thinking-signature handling (§2), fast mode (`query.ts:671-673`), advisor model (`query.ts:695`).

## Verdict summary table

| # | Mechanism | Tag |
|---|---|---|
| 1.1 | Standalone async-generator query loop | ADOPT-P1 |
| 1.2 | Single mutable State object | ADOPT-P1 |
| 1.3 | Typed transition reasons | ADOPT-P1 |
| 1.4 | Terminal stop reasons | ADOPT-P1 |
| 1.5 | maxTurns on main loop | ADOPT-P1 |
| 1.6 | Engine wrapper for non-React callers | ADOPT-P1 (hook) / LATER (class) |
| 1.7 | Engine-assembled message snapshots | ADOPT-P1 |
| 1.8 | Profiler checkpoints | SKIP (profiling infra) |
| 2.1 | Synthetic tool_results for orphans (abort/error/fallback) | ADOPT-P1 |
| 2.2 | Resume-time repair pass (unresolved/thinking/whitespace filters, sentinel) | ADOPT-P1 |
| 2.3 | Turn-interruption detection → continuation marker | ADOPT-P1 |
| 2.4 | Streaming-fallback tombstones | LATER |
| 2.5 | Thinking-signature stripping | SKIP (Anthropic-specific) |
| 2.6 | Error-assistant-aware interruption classification | ADOPT-P1 |
| 2.7 | parentUuid chain-walk transcripts | SKIP (store stays UIMessage) |
| 3.1 | isConcurrencySafe per tool (fail-closed) | ADOPT-P2 |
| 3.2 | Partitioned parallel/serial scheduling (cap ~10) | ADOPT-P2 |
| 3.3 | Streaming tool executor | LATER |
| 3.4 | Bash-error sibling cancellation | SKIP (Bash never parallel here) |
| 3.5 | interruptBehavior per tool | LATER |
| 3.6 | Scheduler-enforced tool_result on every path | ADOPT-P2 |
| 3.7 | Async canUseTool callback | ADOPT-P2 |
| 3.8 | Full rule-grammar permission engine | LATER (port existing policy ADOPT-P2) |
| 3.9 | Central input validation | ADOPT-P2 |
| 3.10 | Loop protection (knightcode-native) | ADOPT-P2 |
| 3.11 | Mode-transition State updates (contextModifier slice) | ADOPT-P2 (general contextModifier LATER) |
| 4.1 | PreToolUse block → error tool_result + systemMessage | ADOPT-P2 (updatedInput/ask LATER) |
| 4.2 | PostToolUse systemMessage → next-round reminder | ADOPT-P2 (blocking PostToolUse LATER) |
| 4.3 | PostToolUseFailure in scheduler | ADOPT-P2 |
| 4.4 | Stop hooks on turn_complete | ADOPT-P2 (blocking-continue LATER) |
| 4.5 | UserPromptSubmit gate in useQueryEngine | ADOPT-P2 |
| 4.6 | Extra hook events (SessionStart, PreCompact, PermissionRequest…) | LATER (Teammate/TaskCompleted SKIP) |
| 4.7 | Hook progress rendering | LATER |
| 5.1 | Per-round attachment injection | ADOPT-P3 (full taxonomy LATER) |
| 5.2 | Volatile-context per-turn caching | ADOPT-P3 |
| 5.3 | Incremental transcript→API conversion | ADOPT-P3 |
| 5.4 | Deferred tools tracked in State (no history rescan) | ADOPT-P1/P3 |
| 5.5 | Never-mutate-sent-bytes caching discipline | ADOPT-P3 |
| 5.6 | Memory/skill prefetch side-models | SKIP (no side-model infra) |
| 5.7 | MCP tool refresh | SKIP (no MCP) |
| 6.1 | Compaction inside the loop, ordered pipeline | ADOPT-P4 |
| 6.2 | Request-view-only microcompact (non-destructive) | ADOPT-P4 |
| 6.3 | Cache-editing microcompact | SKIP (Anthropic beta API) |
| 6.4 | Threshold math w/ summary reserve + buffer | ADOPT-P4 |
| 6.5 | Autocompact failure circuit breaker | ADOPT-P4 |
| 6.6 | Compact boundary message + request-view slice | ADOPT-P4 |
| 6.7 | Post-compact file/plan/skill restoration attachments | LATER |
| 6.8 | Post-compaction usage re-estimate | ADOPT-P4 |
| 6.9 | API-round grouping for split points | ADOPT-P4 |
| 6.10 | Session-memory compaction | SKIP (no subsystem) |
| 6.11 | History snip | LATER |
| 6.12 | Context collapse | SKIP (experimental) |
| 6.13 | Summarizer PTL head-truncation retry | LATER |
| 7.1 | Stream-error retry with backoff + retry rows | ADOPT-P4 |
| 7.2 | Fallback model chain | LATER |
| 7.3 | Withhold-then-recover error handling | ADOPT-P4 |
| 7.4 | Reactive compaction on overflow (single-shot guard) | ADOPT-P4 |
| 7.5 | max_output_tokens meta-nudge resume | ADOPT-P4 (cap escalation SKIP) |
| 7.6 | Empty/malformed response retry | ADOPT-P4 |
| 7.7 | Blocking-limit preempt | ADOPT-P4 |
| 7.8 | Token-budget auto-continue | LATER |
| 7.9 | task_budget API param | SKIP (Anthropic beta) |
| 7.10 | Image error recovery | SKIP (no image input) |
| 8.1 | Subagents on recursive query() | ADOPT-P5 |
| 8.2 | Streaming subagent progress (generateText → query) | ADOPT-P5 |
| 8.3 | Parallel subagents via scheduler | ADOPT-P2/P5 |
| 8.4 | Inherited mode + shared permission policy | ADOPT-P5 |
| 8.5 | Subagent model resolution/override | ADOPT-P5 |
| 8.6 | Depth limit / no nested Agent | ADOPT-P5 |
| 8.7 | Background completion → notification FIFO drain | ADOPT-P5 (keep) |
| 8.8 | Forked-agent prompt-cache sharing | SKIP (provider-specific) |
| 9.1 | Per-tool maxResultSizeChars | ADOPT-P6 (disk spill LATER) |
| 9.2 | Aggregate tool-result budget at assembly time | ADOPT-P6 |
| 9.3 | Head+tail truncation with retrieval hint | ADOPT-P6 |
| 9.4 | isResultTruncated expand affordance | ADOPT-P6 |
| 10.1 | Mid-turn queued user prompts as attachments | LATER |
| 10.2 | Submit-interrupt semantics | LATER |
| 10.3 | Stop hooks at turn end (engine-owned) | ADOPT-P2 |
| 10.4 | Turn timing w/ pause-on-prompt | ADOPT-P1 (keep knightcode's) |
| 10.5 | Cross-round usage accumulation | ADOPT-P1 |
| 10.6 | Haiku tool-use summaries | SKIP (no consumer) |
| 10.7 | clear/rewind preserved in useQueryEngine | ADOPT-P1 |
| 11.1 | Per-tool render methods | ADOPT-P6 |
| 11.2 | Grouped read/search collapsing | ADOPT-P6 |
| 11.3 | Exit-code-aware Bash blocks | ADOPT-P6 |
| 11.4 | Per-tool live progress | ADOPT-P2 (rows/spinners) / ADOPT-P6 (rich) |
| 11.5 | Nested subagent activity UI | ADOPT-P5 |
| 11.6 | Retry/compaction system rows | ADOPT-P4 |
| 11.7 | Interrupted-turn marker from engine | ADOPT-P1 |
| 11.8 | extractSearchText | SKIP (no transcript search) |
| 11.9 | userFacingName/activity descriptions | ADOPT-P6 |
| 12.* | Voice, IDE, swarms/teams, remote/BG sessions, computer use, MCP, analytics, jobs, memory side-models, Anthropic API betas | SKIP |
