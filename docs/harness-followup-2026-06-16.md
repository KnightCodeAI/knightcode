# Harness comparison: follow-up & correctness gaps

**Date:** 2026-06-16 · companion to `docs/harness-comparison.md` · **not committed** (repo rule).
All claude-code refs are `claude-code/src/...`; all knightcode refs are `packages/cli/src/...`.

This answers three questions:
1. How true is the original comparison doc today?
2. Will finishing its plan meaningfully improve output quality?
3. Two bugs you reported — *duplicate identical tool calls* and *editing a file before reading it* — what causes them, what claude-code does, and what to add.

---

## 1. How true is `harness-comparison.md` now?

**The verdicts are still sound; the "knightcode today" column is stale.** The doc was written as Task 0 *before* the engine existed, so it describes the pre-migration `useChat` architecture. That architecture is gone:

- `use-chat.ts` and `local-chat-transport.ts` **no longer exist** — every `use-chat.ts:NNN` / `local-chat-transport.ts:NNN` citation is dead.
- The engine the doc proposed is built: `lib/engine/{query,scheduler,tool-runner,transcript,events,hooks,messages}.ts`, wired via `hooks/use-query-engine.ts` → `screens/session.tsx`.

### What actually shipped (P1 + P2 — done)

| Plan item | Where it landed | Notes |
|---|---|---|
| Standalone async-generator loop (1.1) | `engine/query.ts:74` `query()` | `for (round < maxRounds)` (default 100), yields typed `EngineEvent`, returns `Terminal`. UI-free. |
| Single per-turn State (1.2) | closure in `query()`: `mode`, `loopGuard`, `loadedDeferred`, `reminders`, `usage` | Not one object, but one owner. |
| Terminal stop reasons (1.4) | `query.ts:325,320,385,391` | `complete \| aborted \| max_rounds \| error` — coarser than claude-code's 10 reasons; no `model_error`/`prompt_too_long` split. |
| Engine-assembled snapshots (1.7) | `message_update` events, `snapshot()` `query.ts:55` | UI renders snapshots, not deltas. ✅ |
| Turn timing w/ pause (10.4) | `sealTurn` `query.ts:108`, `getTurnPausedMs` | ✅ |
| Cross-round usage accumulation (10.5) | `addUsage` `query.ts:41,304` | ✅ |
| Transcript repair (2.1, 2.2 partial) | `transcript.ts:27` `repairTranscript` | Strips empty assistant shells, resolves unresolved tool parts → `output-error`, marks `isInterrupted`. No thinking/whitespace filter, no continuation sentinel. |
| Synthetic results for orphans (2.1) | `query.ts:120-134` `sealTurn` + `repairTranscript` | Every unresolved tool part becomes `output-error` on seal and on next load. ✅ |
| Deferred tools in State (5.4) | `loadedDeferred` `query.ts:97`, `trackToolSearchLoads` `query.ts:60` | No more full-history rescan each round. ✅ |
| isConcurrencySafe + partitioned scheduling (3.1, 3.2) | `scheduler.ts:41` `partitionToolCalls`, cap 10 `scheduler.ts:15` | Contracts carry `is_concurrency_safe`; safe runs (Read/Grep/Glob/Agent/Skill/Task*read/Web*) parallel, everything else serial. ✅ |
| Central zod parse (3.9) + every-path ToolOutcome (3.6) | `scheduler.ts:128-139`, `executeOne` always returns `ToolOutcome` | ✅ |
| canUseTool / askQuestion host callbacks (3.7) | `scheduler.ts:173-211` | Throw-safe (a failed prompt becomes a tool error, never orphans the pair). ✅ |
| Gating engine (3.8 port) | `tool-runner.ts:12` `gateToolCall` | AUTO short-circuit, edit/Bash/Config/Agent → confirm. ✅ |
| Loop guard (3.10) | `tool-runner.ts:45` `ToolLoopGuard` | Per-turn, limit 8. **See §3 — too lenient.** |
| Pre/Post/Failure hooks → reminders (4.1–4.3) | `scheduler.ts:141-231`, drained `query.ts:340` | `systemMessage` rides the next round as a `<system-reminder>` user message `query.ts:175-188`. ✅ |
| Mode-transition State updates (3.11) | `query.ts:362-373` | EnterPlanMode/ExitPlanMode flip `mode` mid-round. ✅ |

### What's still backlog (P3–P6 — not done)

- **P3 (context):** `buildRequestContext(cwd)` runs **every round, uncached** (`query.ts:145`); full `convertToModelMessages` of the whole transcript **every round** (`query.ts:199`). No per-round attachment pipe beyond hook reminders.
- **P4 (compaction + recovery) — biggest gap.** There is **no compaction inside the loop** and **no recovery at all.** A stream error just throws → terminal `error` (`query.ts:309-312`). No retry/backoff, no reactive compaction on context overflow, no `max_output_tokens` resume, no empty-response retry. Compaction exists only in `hooks/compact-history.ts` (UI-driven, outside the loop) — the exact "blows context mid-turn" problem the original doc flagged (6.1) is still live.
- **P5 (subagents):** still `generateText` + bespoke `Agent/run-subagent.ts` (`Agent/execute.ts:78,168`), not recursive `query()`. No streaming subagent progress; no compaction/recovery inside subagents.
- **P6 (truncation + renderers):** no per-tool result budgets / retrieval hints in the engine.

---

## 2. Will finishing the plan significantly improve output quality?

**Mostly yes — but the highest-value remaining item is P4, and the plan as written does *not* fix the two bugs you reported.**

Ranked by impact on *output quality* (not effort):

1. **P4 recovery + in-loop compaction — high.** Today a long agentic turn that overflows the context window, or hits a transient stream error, **dies with no recovery**. That's a hard reliability ceiling on exactly the long, tool-heavy tasks where a harness earns its keep. This is the single biggest quality lever left.
2. **§3 + §4 below (read-before-edit, duplicate calls) — high, and not in the plan.** These are correctness bugs you can see in normal use. See below.
3. **P5 subagents — medium.** Streaming + recursive `query()` makes multi-agent work visible and gives subagents the same recovery/compaction. Quality win scales with how much you use Agent.
4. **P3 context — medium/low (mostly cost + latency).** Caching the volatile slice and incremental conversion cut tokens and wall-clock; changed-file attachments modestly improve correctness. Real, but less visible than P4.
5. **P6 — low/medium (UX + token economy).** Truncation hints stop the model re-running tools to "get the rest."

So: finishing the plan is worth it, but **don't expect it to fix the two bugs below** — those need mechanisms the original doc never listed.

---

## 3. Bug: editing a file before it was read (and clobbering external changes)

**This is a real, reproducible harness gap, and the original doc never covered it.**

### What knightcode does
- `Edit/execute.ts:18-27` reads the file fresh from disk and string-matches `old_string`. It **never checks whether the model previously Read the file.**
- `Read/execute.ts` records **nothing** — there is no file-state ledger anywhere in the repo (grep for `readFileState`/`fileTimestamps`/`recordRead` → 0 hits).
- The Edit tool *prompt* literally claims: *"You MUST call Read at least once on this file before calling Edit. The edit will fail if you have not read the file."* (`packages/shared/src/tools/Edit/index.ts:32`). **This is false** — nothing enforces it. Same empty promise in MultiEdit (`shared/.../MultiEdit/index.ts:41`) and NotebookEdit (`:59`).

Two failure modes follow:
1. **Edit-before-read:** the model guesses file contents and edits blind. It only fails if `old_string` happens not to match — a guessed `old_string` that *does* match applies silently.
2. **Stale edit / clobber:** if the file changed on disk since the model last saw it (user edit, linter, a prior tool), the edit applies against *current* disk content with no warning. The model's mental model and the file diverge.

### What claude-code does
A `readFileState: Map<absolutePath, {content, timestamp}>` cache threaded through `toolUseContext`:
- Every read writes it: `FileReadTool.ts:842,1032`; **even Bash reads** (cat/sed/head) write it: `BashTool.tsx:404`.
- Seeded from the transcript on resume so it survives restarts: `print.ts:1147-1164` `extractReadFilesFromMessages`.
- Edit/Write/NotebookEdit `validateInput` rejects before executing:
  - no entry → `"File has not been read yet. Read it first before writing to it."` (`FileEditTool.ts:281`, `FileWriteTool.ts:203`, `NotebookEditTool.ts:226`)
  - file mtime newer than the recorded read → `"File has been modified since read, either by the user or by a linter. Read it again before attempting to write it."` (`FileEditTool.ts:306`, `FileWriteTool.ts:216`)
- After a successful edit, the tool updates the ledger (`FileEditTool.ts:520`) so back-to-back edits don't trip on themselves.

### Recommendation — add a file-state ledger (new mechanism, ~P2.5)
- Add a session-scoped `Map<resolvedPath, {mtimeMs, size}>` owned by the engine/host (not per-tool — it must persist across the turn and seed from the transcript on resume).
- `Read` (and `Bash`, ideally) record the entry after a successful read.
- `Edit`/`MultiEdit`/`Write`/`NotebookEdit` gain a real precondition check at the top of `execute` (or, better, a `validateInput` step the scheduler runs centrally so the error is a uniform `output-error` tool_result):
  - not in ledger → error "read it first";
  - `statSync(resolved).mtimeMs` newer than recorded → error "modified since read, read it again".
- Update the ledger after a successful write.
- This is also a natural home for a cheap fix to half of the duplicate-read problem (§4): if the model is told "you already read this at <time>," it has less reason to re-Read.

This belongs in the engine/scheduler layer (so it composes with the central zod parse and uniform error pairing already in `scheduler.ts:128-139`) rather than bolted into each tool's `execute`.

---

## 4. Bug: the same tool called with identical params 2+ times

Partly model behavior, partly harness. The harness levers:

### What exists today
- `ToolLoopGuard` (`tool-runner.ts:45`) keys on `toolName + JSON.stringify(input)` and only rejects after **8 identical calls** in a turn (`LOOP_LIMIT = 8`). So 2–7 identical calls pass through untouched — exactly the "twice or even more" you're seeing.
- Within a single round, if the model emits two identical tool-calls, the scheduler runs **both** (`scheduler.ts:251`) — no dedup.

### What claude-code relies on (it has no loop guard)
claude-code tolerates no loop guard because its results are *reliable and durable*: guaranteed tool_use/tool_result pairing, the read-file ledger (so re-reads are cheap/discouraged), truncation hints instead of silent cut-offs (§9.3), and microcompaction that preserves recent results. The engine now has the pairing guarantee; it's missing the rest.

### Recommendations (cheap → structural)
1. **Lower the loop-guard threshold and make the signal earlier.** 8 is far too lenient; 2–3 identical calls already indicate a stuck model. Lower `LOOP_LIMIT` to ~3 and keep the clear corrective error (`tool-runner.ts:62`). Keep TodoWrite exempt.
2. **Dedup identical calls within a round.** In a safe parallel batch (`scheduler.ts:247`), collapse calls with identical `toolName + input` to one execution and fan the single `ToolOutcome` out to all matching `toolCallId`s. Pure harness win, zero model dependence, safe because these tools are read-only.
3. **Add the read-file ledger (§3).** Removes the most common *legitimate* reason to repeat a Read.
4. **Finish P6 truncation hints.** A model re-runs a tool when it suspects the result was cut off. `"… [N lines elided — re-run with offset/limit]"` (original doc 9.3) tells it how to get more instead of blindly repeating.
5. **Finish P4 compaction.** Without in-loop compaction, on a long turn older results fall out of the model's effective attention and it re-fetches. Compaction that preserves recent tool outputs reduces this.

Items 1–2 are small and land entirely in `tool-runner.ts` / `scheduler.ts`. Items 3–5 are the structural fixes.

---

## 5. Bottom line

- The original doc's **verdicts hold**; its **"knightcode today" column is dead** (cite the engine, not `use-chat.ts`).
- **P1/P2 shipped. P3–P6 remain**, and **P4 (recovery + in-loop compaction) is the highest-value remaining work** for output quality.
- **Neither reported bug is addressed by the plan.** They need two additions the doc never had:
  - a **file-state ledger + read-before-write/staleness guard** (§3) — fixes edit-before-read and stale clobbering, and the Edit prompt currently lies about this;
  - a **stricter loop guard + within-round dedup** (§4) — fixes duplicate identical calls.
- Quickest high-value moves: lower `LOOP_LIMIT`, dedup identical safe calls, and add the read-file ledger. Then prioritize P4.
