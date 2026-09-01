# Knightcode upgrade plan — memory, skill auto-use, harness

**Date:** 2026-06-16 · **not committed** (repo rule).
Builds on `knightcode-vs-claude-code-audit-2026-06-16.md` and `harness-followup-2026-06-16.md`.

Part 1 explains **how claude-code actually does it** (memory, automatic skill use, the
harness substrate). Part 2 is a **phased changeset plan** mapped onto real knightcode files
and seams. Refs: `claude-code/src/...` (CC) and `packages/cli/src/...` (KC).

---

# PART 1 — How claude-code does it

## 1.1 Memory (the parts KC has none of)

**Storage model.** Memory is NOT `CLAUDE.md`. It's a directory of one-fact-per-file markdown
notes at `~/.claude/projects/<project-path>/memory/`, plus a `MEMORY.md` index.
- Each memory file has frontmatter: `name`, `description`, `metadata.type` where type ∈
  `user | feedback | project | reference` (`memdir/memoryTypes.ts`).
- `MEMORY.md` is a one-line-per-memory index, capped at **200 lines / 25 KB**
  (`memdir/memdir.ts:33-35`, `truncateEntrypointContent`), loaded into the **system prompt**
  every session. The bodies are *not* loaded — only the index.

**Recall (read path).** Per turn, before the model runs, a cheap **side-query** picks which
memories are relevant (`memdir/findRelevantMemories.ts`):
1. `scanMemoryFiles(dir)` reads every memory file's frontmatter header (name + description),
   newest-first, cap 200 (`memoryScan.ts`).
2. A Sonnet side-query gets `{user query, recent tools, header list}` and returns **≤5
   filenames** it's *certain* are useful (`SELECT_MEMORIES_SYSTEM_PROMPT`). Selective by
   design — empty list is fine.
3. `alreadySurfaced` filters memories shown in prior turns so the 5-slot budget goes to fresh
   ones. The selected bodies are injected as an **attachment** (request-view, not persisted).
4. Prefetch is **overlapped with streaming** — fired once per turn, consumed zero-wait after
   tools (`query.ts:301-304,1592-1614`).

**Extraction (write path).** At the end of every *complete* turn (final response, no tool
calls), `extractMemories` runs inside Stop hooks (`services/extractMemories/extractMemories.ts`):
- A **forked agent** (perfect fork of the conversation, shares the prompt cache —
  `utils/forkedAgent.ts`) is asked "what durable facts from this session should be saved?"
- It writes new memory files + updates `MEMORY.md`, following the type taxonomy and the
  "what NOT to save" rules (don't save code/architecture/git — those are derivable).

**Consolidation.** `services/autoDream` periodically merges/dedups/cleans the memory dir
behind a lock (`consolidationLock.ts`, `consolidationPrompt.ts`) so it doesn't rot.

**Commands/tools.** `/memory` (`commands/memory`) edits memory; recall+extraction are
automatic (no tool — the model never calls them, the harness does).

> KC equivalent today: `/memory` opens `memory-dialog.tsx` to hand-edit `KNIGHTCODE.md`.
> No memory dir, no recall, no extraction, no consolidation.

## 1.2 Automatic skill use in a turn

**Discovery index.** Skills + slash-commands are rendered into context as a **budget-capped
listing** — 1% of the context window (~8k chars), 250 chars/entry
(`tools/SkillTool/prompt.ts:20-27`, `formatCommandsWithinBudget`). Name + description only;
the body is loaded on demand. This is the always-present "menu" the model picks from.

**On-demand load.** The model calls the `Skill` tool to pull the full `SKILL.md` body
(`tools/SkillTool/SkillTool.ts`), then follows it.

**Active nudging (this is the "automatic" part).** `attachments.ts` defines attachment types
`skill_listing`, `skill_discovery`, `invoked_skills`, `dynamic_skill` (`attachments.ts:525-647`):
- **Turn-0 discovery:** the user's input is used as a signal to surface relevant skills
  (`attachments.ts:789`).
- **Inter-turn discovery:** `startSkillDiscoveryPrefetch` in `query.ts` runs a side-query
  **gated on write-pivot detection** — when the model pivots from reading to writing code,
  it surfaces skills relevant to what's being built (`services/skillSearch/prefetch.ts`,
  feature `EXPERIMENTAL_SKILL_SEARCH`).
- **Delta tracking:** `resetSentSkillNames`/sent-set means each skill is announced once, not
  re-sent every turn.

**Hot reload.** `utils/skills/skillChangeDetector.ts` (chokidar) watches skill dirs and
clears caches when `SKILL.md` files change, so new/edited skills appear without restart.

> KC equivalent today: `buildSkillIndex` puts the full skill index in the **system prompt**
> (static, cached) and the model may call `Skill`. No budget cap, no discovery prefetch, no
> write-pivot nudge, no hot reload, no delta tracking. Works, but skills are under-surfaced.

## 1.3 Harness substrate both of the above ride on

Memory recall and skill discovery are both **attachments injected per turn between rounds**
(`getAttachmentMessages`, appended to tool results — `query.ts:1580-1590`). KC has only two
narrow versions of this channel:
- submit-time: `expandAtMentions` injects a `system-reminder` text part on the user message
  (`use-query-engine.ts:386-402`);
- per-round: hook `systemMessage`s ride along as a `<system-reminder>` user message
  (`query.ts:175-188`).

There is **no general provider pipe** and **no side-query helper** (`utils/sideQuery.ts` in
CC; KC has nothing). Both must be built first — they're the foundation for Phases B & C.

---

# IMPLEMENTATION STATUS (2026-06-16)

**Phase A (substrate) and Phase B (memory) are implemented and green** (360 tests pass,
`tsc --noEmit` clean). Files:
- A: `lib/inference/side-query.ts` (configurable side-model, falls back to main model),
  `lib/engine/context-providers.ts`; wired via `engine/events.ts` (`contextProviders` param)
  and `engine/query.ts` (turn-start injection before round 0).
- B: `lib/memory/{paths,scan,config,json,recall,extract}.ts`; `memoryIndex` rendered in
  `system-prompt.ts`, read per-turn in `build-request-context.ts`; recall provider + turn-end
  extraction wired in `hooks/use-query-engine.ts`; settings `sideQueryModel` +
  `memory.enabled` in `settings.ts`. Tests in `lib/memory/memory.test.ts`.
- Behavior: per-turn recall (≤5 memories via side query, injected as a `<system-reminder>`),
  extraction on cleanly-completed turns into `~/.knightcode/projects/<cwd>/memory/` +
  `MEMORY.md` index in the system prompt. Costs nothing until memory files exist; gated by
  `memory.enabled` (default on). Side model falls back to the turn's main model when
  `sideQueryModel` is unset.

Not yet done (follow-ups): memory-dialog UI to browse/delete memory files; cross-turn
`alreadySurfaced` dedup; `autoDream` consolidation; Phases C–E below.

---

# A/B HARDENING (2026-06-16, after first live test)

First live test (model `openai/gpt-oss-120b`): a feedback preference **was** correctly
extracted to `…/memory/show-before-after-and-verify.md` + `MEMORY.md`. It *looked* like
nothing happened because of two visibility gaps, not a logic bug.

**Done (Tier 1 — visibility & observability):**
- `lib/debug.ts` — `debugLog()` to `~/.knightcode/debug.log`, opt-in via `KNIGHTCODE_DEBUG`
  (never writes to the TUI). Wired into recall (candidates/selected) and extract
  (transcript/raw/parsed counts; explicit warning when the side model returns empty text).
- In-session toast "Saved N memories (/memory to view)" on a successful extraction
  (`use-query-engine.ts`).
- `/memory` dialog now lists auto-memories (was KNIGHTCODE.md-only) — `memory-dialog.tsx`
  reads `scanMemoryFiles(cwd)`. This was the actual reason the save looked invisible.
- Verified: `tsc` clean, 360 tests pass.

**Done (Tier 2 — quality & cost):** all verified — `tsc` clean, 365 tests pass.
1. **Recall latency — DONE.** Turn-start providers are now bounded by `contextProviderTimeoutMs`
   (default 6 s, `query.ts` Promise.race): a slow side model yields no context this turn
   instead of stalling the first token, and its result still populates the provider cache for
   next turn.
2. **Dedup — DONE (correctly re-scoped).** Naive "already-surfaced" suppression would *drop*
   memories, because reminders are request-view-only (a memory surfaced last turn isn't in
   this turn's transcript) — re-injecting each turn is correct. Instead the recall provider
   caches by `cwd+query` (hoisted to a ref in `use-query-engine` so it survives across turns),
   so identical consecutive queries (retries/regenerations) skip the redundant selector call.
3. **Extraction cost gate — DONE.** `hasExtractableSignal()` skips the side query on trivial
   turns (user text < 15 chars: greetings, "ok"). Model still returns [] as the backstop.
4. **Side-query robustness — DONE.** Token budgets raised (recall 2048, extract 4096) so a
   reasoning side model's reasoning tokens can't starve the JSON answer; reasoning kept at
   "low". Debug log warns when the model returns empty text.
5. **Extraction dedup/update — DONE.** Prompt instructs reuse of an existing memory's filename
   for updates (update-in-place, no near-duplicates); slugs strip `.md`; byte-identical
   rewrites are skipped (no churn, preserves recency ordering).
6. **Tests — DONE.** `memory.test.ts` now covers the model path via an injected `sideQueryImpl`:
   recall mapping, provider caching, extract write+index+churn-skip, trivial-turn skip,
   `hasExtractableSignal`.
7. **autoDream consolidation** — still LATER (periodic merge/cleanup).

**Done (Tier 3 — memory management / deletion):** the model previously could NOT remove a
memory (file tools are sandboxed to the project root; memory lives outside it; no memory
tool; `/memory` only appended to KNIGHTCODE.md). Added:
- `lib/memory/store.ts` — `upsertMemory` / `deleteMemory` / `regenerateMemoryIndex` /
  `slugifyMemoryName`; `extract.ts` refactored to reuse it (no duplicated write/index logic).
- **`Memory` tool** (shared contract + cli executor, registered everywhere): actions
  `list` / `delete` / `update`, scoped to the memory dir. Always-available; delete/update
  gate to **confirm** in non-AUTO modes (`tool-runner.ts`). Mentioned in the BUILD tool list.
  So "forget that I prefer X" now works.
- **`/memory` is now an auto-memory manager** (`memory-dialog.tsx`): lists memories via
  `DialogSearchList`, two-step Enter-to-delete with confirm toast. (The old KNIGHTCODE.md
  append was removed from this dialog — edit that file directly / use `/init`.)
- Tests: store round-trip + churn-skip, Memory tool list/update/delete + missing-name error.
  Verified — shared + cli `tsc` clean, 369 cli + 18 shared tests pass.

**Done (Tier 4 — claude-code parity for memory):** reworked extraction + prompts to match
claude-code's actual mechanisms.
- **Extraction is now a forked agent** (claude-code `services/extractMemories` + `runForkedAgent`),
  not a single side-query. `lib/memory/extract.ts` runs the real engine `query()` in AUTO mode
  with a restricted toolset `[Read, Grep, Glob, Memory]` (engine gained `allowedToolNames` —
  `events.ts`/`query.ts`), via a background `ToolHost` (`background-host.ts`). The agent
  investigates with Read/Grep/Glob and persists via the `Memory` tool (knightcode's analog of
  claude-code's Write/Edit-into-memory-dir, since file tools are sandboxed). `maxRounds: 6`.
  - **Mutual exclusion** (`hasMemoryWritesSince`): skip extraction when the main turn already
    called `Memory(update/delete)`.
  - **Manifest pre-injection** + **trivial-turn gate** retained.
- **Prompts ported faithfully** (`lib/memory/prompts.ts`) from `memdir/memoryTypes.ts`: the full
  four-type taxonomy (descriptions/when-to-save/body-structure/examples), "What NOT to save",
  and the recall-side **"Before recommending from memory"** guidance (TRUSTING_RECALL + drift
  caveat) now injected with the Memory Index in the system prompt.
- **YAML-safe frontmatter** — descriptions are newline-collapsed + JSON-quoted on write;
  `scan.ts` parses quoted scalars. Fixes the escaping sharp edge.
- Verified — shared + cli `tsc` clean, 370 cli + 18 shared tests pass.

**Deliberate deviations from claude-code (with reasons):**
- **Recall is synchronous (timeout-bounded), not prefetch-overlapped.** claude-code starts the
  recall side-query at turn start and consumes it *after* the first tool round to hide latency;
  knightcode injects it *before* the first response (so memory is present from token 0) and
  bounds the wait at 6 s. Arguably better for quality, slightly worse for latency. The
  `alreadySurfaced` dedup is intentionally omitted (knightcode reminders are request-view-only,
  so re-injecting each turn is correct; cross-turn suppression would drop memories).
- **No prompt-cache sharing** — Anthropic-only; the forked agent re-sends context (more tokens).
  Mitigated by the configurable `sideQueryModel`.

**Done (Tier 5 — extraction concurrency guard):** side-by-side review against claude-code
found one real gap — extraction fired `void` per completed turn with no in-flight guard, so
overlapping turns could run two forked agents at once and race on Memory writes + the
MEMORY.md regen. Added `lib/memory/extract-scheduler.ts` (`scheduleMemoryExtraction`):
serializes runs and coalesces to a single trailing run for the latest context (mirrors
claude-code's `inProgress` + `pendingContext`). Hook now schedules instead of firing directly.
Tested (serialize/coalesce/onSaved). 372 cli tests pass, tsc clean.

**Reviewed and deliberately NOT changed (with reasons):**
- Recall synchronous (6 s-bounded, before round 0) vs claude-code's prefetch-overlapped — ours
  guarantees memory from token 0; theirs hides latency. Acceptable tradeoff.
- `alreadySurfaced` omitted — correct, since our reminders are request-view-only.
- No prompt-cache sharing — Anthropic-only, impossible on OpenRouter BYOK.
- Extraction toolset excludes Bash (uses `[Read,Grep,Glob,Memory]`) — stricter/safer than
  claude-code's read-only-Bash allowance; Memory tool + Read/Grep/Glob cover the need.
- Deterministic MEMORY.md regen (store.ts) instead of agent-written index — can't drift.

**Lower-priority follow-ups:** ~~pass `recentTools` to the recall selector; session-cursor for
extraction (reconsider gate-skipped turns); shutdown drain~~ — all DONE (Tier 8 below).

**Done (Tier 6 — autoDream consolidation, full memory parity):** ported claude-code's
background memory consolidation.
- `lib/memory/consolidation-lock.ts` — lock file `.consolidate-lock` in the memory dir whose
  **mtime IS lastConsolidatedAt**, body = holder PID, with PID-liveness + 1 h stale guard and
  rollback (claude-code `consolidationLock.ts`, ported to sync fs).
- `lib/memory/auto-dream.ts` — `maybeRunConsolidation`: gates cheapest-first **enabled → time
  (≥ minHours, default 24) → sessions (≥ minSessions updated since last, default 5, via the
  sqlite session store) → lock**. On pass, runs a **forked agent** (engine `query()`, AUTO,
  tools `[Read,Grep,Glob,Memory]`, maxRounds 12) with the consolidation prompt; rolls back the
  lock on failure so the time-gate reopens.
- `buildConsolidationPrompt` (`prompts.ts`) — ported claude-code's dream prompt (orient → merge →
  prune → tighten), adapted to operate through the **Memory tool**.
- **`Memory(get)` action added** (shared contract + executor + `store.ts` `readMemoryBody`) so
  the consolidation agent can read full bodies before merging — the memory dir is outside the
  project root, so Read/Grep can't reach it. `get` is read-only (no permission gate).
- Wired into `extract-scheduler.ts`: consolidation runs in the **same serialized slot** as
  extraction (the two forked agents never overlap); self-gates, so a no-op on most turns.
- Settings: `memory.autoDream` (off by default — heavier pass, only worthwhile once memory has
  accumulated), `memory.dreamMinHours`, `memory.dreamMinSessions`.
- Tests: lock acquire/rollback/reclaim, gate behavior (disabled/enabled/time-gated), `Memory(get)`.
  Verified — shared + cli `tsc` clean, 379 cli + 18 shared tests pass.

**Memory is now at full claude-code parity** (recall, forked-agent extraction, management tool,
consolidation), minus the two documented BYOK-driven deviations (synchronous recall, no
prompt-cache sharing). The three lower-priority niceties (`recentTools` recall signal,
extraction session-cursor, shutdown drain) are now done — see Tier 8 below.

**Done (Tier 7 — Phase A per-round context injection, closes the substrate gap):** the
provider pipe now runs **between tool rounds**, not just turn-start — matching claude-code's
`getAttachmentMessages` (attachments appended after every tool round).
- `ContextProvider` now carries a `phase: "turn_start" | "per_round"`; `runContextProviders`
  filters by phase. Engine runs turn_start once before the first response and per_round after
  each tool round (output consumed by the next request), both timeout-bounded.
- Memory recall stays `turn_start` (once per turn — same as claude-code).
- New **changed-files provider** (`lib/inference/changed-files-provider.ts`, `per_round`):
  reminds the model which files it has modified this turn (via session-snapshot), self-gating
  and deduped — the canonical claude-code per-round attachment. Engine gained `sessionId` so
  providers that need it can run.
- Tests: phase filtering, throw/empty handling, changed-files emit-once-then-dedup. 386 cli
  tests pass, tsc clean.

**Phase A is now at parity with claude-code's substrate.** Remaining attachment *types*
(todos, date-change, nested KNIGHTCODE.md, deferred-tools delta) are pluggable per-round
providers — additive feature work, not a substrate gap.

**Done (Tier 8 — the three lower-priority A/B follow-ups):** all verified — `tsc` clean,
406 cli tests pass.
1. **`recentTools` recall signal — DONE.** `recentToolNames(messages)` (in
   `engine/context-providers.ts`) extracts the most recently used tool names (newest-first,
   deduped, capped); the recall provider feeds them to `findRelevantMemories`, which adds a
   "Recent tools used: …" line to the selector prompt (selector system prompt updated to use
   it as a task hint).
2. **Extraction session-cursor — DONE.** `lib/memory/extract-cursor.ts` tracks, per session,
   the message-array length up to which extraction last *actually ran*. `extractMemories`
   takes a `sessionId`, frames the "~N new messages" window as `length − cursor` (falling back
   to last-turn when there's no cursor / a stale one after compaction), and advances the cursor
   only when a run completes — so a durable fact mentioned during a gate-skipped turn (trivial,
   or main-agent-already-saved) stays in scope for the next real extraction. Threaded through
   `extract-scheduler.ts` + `use-query-engine.ts`.
3. **Shutdown drain — DONE.** `drainMemoryExtraction()` (`extract-scheduler.ts`) awaits the
   in-flight run plus any coalesced trailing run to completion (no-op when idle). Wired into the
   `/exit` choke point (`input-bar.tsx`), bounded by a 3 s race so a hung side model can't block
   exit. (The synchronous `process.on("exit")` / SIGTERM paths can't drain async — `/exit` is
   the documented graceful path.)
   - Tests: `recentToolNames` order/dedup/cap, recall passes recent tools, cursor advance/window/
     gate-skip, drain in-flight + coalesced trailing + idle no-op (`memory.test.ts`).

---

# PART 2 — Phased changeset plan

Ordering = dependencies + value. Each phase is independently shippable and testable.

## Phase A — Context-provider substrate + side-query helper  *(foundation)*

**Goal:** one place to inject per-turn context (memory, skills, changed files) and one cheap
side-model call helper. Unblocks B, C, and the attachment items from the audit (§11).

**Changeset:**
- **NEW `lib/inference/side-query.ts`** — `sideQuery({system, prompt, signal, maxTokens})`
  using `resolveModel` with a cheap model id (config `sideQueryModel`, default to a small
  OpenRouter model) + `generateText`. One-shot, no tools, abortable. This is the primitive
  recall/extraction/skill-discovery all use.
- **NEW `lib/engine/context-providers.ts`** — `type ContextProvider = (ctx) => Promise<string[]>`
  and a registry. The engine calls registered providers once per turn and folds their strings
  into the existing `reminders` channel.
- **EDIT `lib/engine/events.ts`** — add `contextProviders?: ContextProvider[]` to `QueryParams`.
- **EDIT `lib/engine/query.ts`** — at `:175` (where `pendingReminders` is assembled), also
  drain provider output for the *first* round (turn-start providers) and after tool rounds
  (inter-round providers). Keep the request-view-only discipline (never persist).
- **TEST** `context-providers.test.ts` + extend `query.test.ts` (provider output appears in
  the request, exactly once).

**Effort:** S. **Risk:** low (additive; no behavior change when no providers registered).

## Phase B — Memory system  *(highest user-visible value)*

Depends on Phase A.

**Changeset:**
- **NEW `lib/memory/paths.ts`** — `getMemoryDir(cwd)` → `~/.knightcode/projects/<hash>/memory/`,
  `getMemoryIndexPath()` → `MEMORY.md`. Mirror CC's per-project layout.
- **NEW `lib/memory/scan.ts`** — `scanMemoryFiles(dir)` → `{name, description, type, path,
   mtimeMs}[]`, frontmatter-only, newest-first, cap 200. (Reuse the frontmatter parser already
  in `lib/context/rules.ts`.)
- **NEW `lib/memory/recall.ts`** — `findRelevantMemories(query, dir, signal, recentTools,
   alreadySurfaced)`: scan → `sideQuery` selector (port CC's `SELECT_MEMORIES_SYSTEM_PROMPT`)
  → return ≤5 paths. Register as a **turn-start ContextProvider** that reads the selected
  bodies and emits them as a `<system-reminder>` block.
- **NEW `lib/memory/extract.ts`** — `extractMemories(transcript, dir, signal)`: a `sideQuery`
  (or a small forked-style prompt) over the turn transcript that emits memory files to write +
  MEMORY.md index lines. Port CC's taxonomy + "what not to save" prompt
  (`memdir/memoryTypes.ts`, `services/extractMemories/prompts.ts`). Write files atomically.
- **EDIT `lib/inference/system-prompt.ts`** — add a `memoryIndex?: string` param; render it as
  a `## Memory Index` block (mirror the existing skill-index block at `:180-189`, same
  lower-trust framing). Load + truncate to 200 lines / 25 KB.
- **EDIT `lib/inference/build-request-context.ts`** — read `MEMORY.md`, expose `memoryIndex`.
- **EDIT `hooks/use-query-engine.ts`**:
  - register the recall provider in the `query({...})` call (`:422`);
  - after `turn_complete`/in the Stop-hook block (`:509-513`), fire `extractMemories` for
    complete turns (skip aborted/error). Run async, never block the next turn.
- **EDIT `components/dialogs/memory-dialog.tsx`** — show the memory dir + index, not just
  KNIGHTCODE.md; allow browse/delete of memory files.
- **EDIT `lib/agents/built-in.ts`** — the help/guide agent text already references memory; keep
  accurate.
- **TEST** `recall.test.ts`, `extract.test.ts` (golden transcript → expected files), scan cap.

**Effort:** M. **Risk:** med (side-model cost per turn — gate behind a `memory.enabled`
setting, default on; extraction is once per *complete* turn only).

**Notes / decisions:**
- Use a **cheap side model** for both recall and extraction (config `sideQueryModel`).
- KC has no prompt-cache fork; extraction runs as a plain `sideQuery` over the (already
  compacted) transcript — slightly more tokens than CC's fork, acceptable.
- Skip `autoDream` consolidation in v1 (LATER) — add once memory volume warrants it.

## Phase C — Skill auto-discovery  *(makes existing skills actually fire)*

Depends on Phase A. KC already has skill loading + index + Skill tool, so this is the
"automatic" layer only.

**Changeset:**
- **EDIT `lib/inference/system-prompt.ts`** — budget-cap the skill index (port
  `SKILL_BUDGET_CONTEXT_PERCENT`, `MAX_LISTING_DESC_CHARS=250`) so a big skill library can't
  blow turn-1 tokens.
- **NEW `lib/context/skills/discovery.ts`** — `discoverRelevantSkills(signal, skillHeaders,
   alreadySent)`: `sideQuery` that, given the user text (turn 0) or the last assistant
  activity (inter-turn), returns skill names worth nudging. Register as a ContextProvider that
  emits a short "Consider these skills: …" reminder. Track a sent-set so each fires once.
- **NEW `lib/context/skills/watcher.ts`** — chokidar watcher over `~/.knightcode/skills` and
  `.knightcode/skills`; on change, clear the skill cache (port the debounce from CC's
  `skillChangeDetector.ts`). Wire into session startup in `screens/session.tsx`.
- **EDIT `lib/context/skills/skills.ts`** — add a memoization cache + `clearSkillCaches()` for
  the watcher to call.
- **TEST** `discovery.test.ts`, watcher debounce test.

**Effort:** S–M. **Risk:** low. Gate discovery behind `skills.autoDiscover` (default on);
watcher behind a flag for environments where chokidar misbehaves (CC has Bun watch caveats).

## Phase D — Harness reliability  *(recovery + in-loop compaction + file ledger)*

Independent of A–C. Detailed in `harness-followup-2026-06-16.md`; restated as changesets.

**Changeset:**
- **NEW `lib/engine/recovery.ts`** — `withRetry(fn, {maxRetries, signal})`: bounded
  exponential backoff + Retry-After honoring; classify retryable stream errors. Emit a `retry`
  EngineEvent (for UI rows).
  - **EDIT `lib/engine/query.ts:206`** — wrap the `streamText` round in `withRetry`; on
    context-overflow rejection, run reactive compaction once (single-shot guard) and continue;
    on empty response, retry once.
  - **EDIT `lib/engine/events.ts`** — add `retry` event + `reactive_compact` terminal-less
    transition.
- **MOVE compaction into the loop** — call the existing `compact-conversation.ts` summarizer
  + a new non-destructive microcompact from inside `query.ts` between rounds (port the
  ordering: budget → microcompact → autocompact). Today it's UI-only at
  `use-query-engine.ts:380,508`. Make it request-view (boundary message + slice), not a
  destructive `replaceSessionMessages`.
- **NEW `lib/engine/file-ledger.ts`** — session `Map<resolvedPath, {mtimeMs}>`; thread through
  `ToolHost`/`QueryParams`.
  - **EDIT `lib/tools/Read/execute.ts`** + Bash read paths — record on success.
  - **EDIT `lib/tools/{Edit,MultiEdit,Write,NotebookEdit}/execute.ts`** OR (better) add a
    central precondition in `scheduler.ts:executeOne` after the zod parse: reject with
    "read it first" / "modified since read" using the ledger; update ledger after write.
- **EDIT `lib/engine/tool-runner.ts`** — lower `LOOP_LIMIT` 8→3; add within-round dedup of
  identical safe calls in `scheduler.ts:247` (one execution, fan result to all ids).
- **TEST** recovery (overflow→compact→continue), ledger (read-before-edit + staleness), dedup.

**Effort:** L. **Risk:** med (compaction correctness) — land recovery + ledger + dedup first
(smaller, high value), then in-loop compaction.

## Phase E — Subagents on the real loop + streaming  *(quality + visibility)*

Depends on D (so subagents inherit recovery/compaction).

**Changeset:**
- **DELETE `lib/tools/Agent/run-subagent.ts`** (bespoke `generateText` loop).
- **EDIT `lib/tools/Agent/execute.ts`** — call `engine/query()` recursively with a subagent
  `host`/`hooks`, inherited permission policy (not hardcoded `BUILD`), depth limit, Agent
  stripped from the child toolset.
- **EDIT `lib/engine/events.ts`** + `use-query-engine.ts` — bubble child `message_update`/
  `tool_*` events tagged with `agentId`; render nested under the Agent row.
- **EDIT `components/messages/tool-call-view.tsx`** (or a new `agent-activity.tsx`) — nested
  live subagent activity.
- **TEST** subagent recursion, depth limit, event tagging.

**Effort:** M–L. **Risk:** med.

---

## Suggested sequencing

| Order | Phase | Why first | Size |
|---|---|---|---|
| 1 | **A** substrate + side-query | unblocks B & C | S |
| 2 | **D (ledger + dedup + recovery)** | fixes visible bugs, reliability | M |
| 3 | **B** memory | biggest user-visible feature | M |
| 4 | **C** skill auto-discovery | cheap once A lands | S–M |
| 5 | **D (in-loop compaction)** | hardest correctness | M |
| 6 | **E** subagents | depends on D | M–L |

Phase A is the keystone: a `sideQuery` helper + a context-provider pipe are tiny on their own
but every "automatic" claude-code behavior (memory recall, skill discovery, changed-file
attachments) is just a provider on top of them.

## Open questions for you
- **Side-model choice:** which cheap OpenRouter model for recall/extraction/discovery
  (cost vs quality)? Add a `sideQueryModel` setting.
- **Memory default:** on or off by default? (CC: on, gated by `isAutoMemoryEnabled`.)
- **Scope:** want all of A–E, or start with A + B (memory) since that's the headline gap?
