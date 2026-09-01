# KnightCode → pi engine, Claude Code UI — Transformation Tracker

**Started:** 2026-08-28 · **Branch:** `cli-rewrite` · **Status:** Phase 1 done, Phases 2–4 not started

> Living tracker. Update the progress marks as work lands. **Uncommitted by
> convention** (`ROADMAP.md`: never commit specs/plans/trackers — code only).
>
> Companion design doc: `docs/superpowers/specs/2026-08-28-pi-engine-migration-design.md`
> Supersedes: `docs/superpowers/ROADMAP.md` (stale — describes the pre-port OpenTUI era)

---

## The goal

Take pi's low-token harness and multi-provider layer, keep Claude Code's UI.

| Layer | Source | Fate |
| --- | --- | --- |
| UI (`src/tui` 20k LOC, `src/components` 63k LOC) | Claude Code | **Keep, untouched** |
| Tool + system prompts | Claude Code | Diet to pi length |
| Agent loop / harness | `shenanigans/pi/packages/agent` | Vendor + adopt |
| Providers (39) | `shenanigans/pi/packages/ai` | Vendor + adopt |

The whole plan rests on one verified fact: **`query()` is a single async generator
with 7 consumers**, and the raw Anthropic wire type `BetaRawMessageStreamEvent`
appears in exactly 2 files. The UI renders the *accumulated* `AssistantMessage`,
not raw deltas. So the engine can be swapped behind that one signature without
touching a single UI file.

---

## Progress

| # | Phase | Status | Outcome |
| --- | --- | --- | --- |
| 1 | `prompt-diet` | ✅ **DONE** (uncommitted) | 92,061 → 45,748 chars (~23,015 → ~11,437 tok), 50% cut |
| 2 | `vendor-pi` | ⬜ Not started | Copy `pi-ai` + `pi-agent` in, additive only |
| 3 | `pi-adapter` | ⬜ Not started | `piAdapter.ts` behind `KNIGHTCODE_ENGINE=pi` |
| 4 | `pi-default` | ⬜ Not started | Flip default, delete old transport |

---

## Measured facts

**Never size prompts by reading `prompt.ts` files.** They hold several exports and
conditional branches, only some of which reach the wire — file-based measurement
overstates by ~2x (estimated 31k vs 17k actual). Measure through the harness's own
assembly path. `src/prompt-budget.test.ts` does exactly this and is the guard rail.

| | Baseline (interactive) | Now | Cut |
| --- | ---: | ---: | ---: |
| Tool descriptions | 67,841 (35 tools) | 26,879 (27 tools) | 60% |
| System prompt | 24,220 | 18,869 | 22% |
| — of which auto-memory block | 12,581 | 7,229 | 43% |
| — of which behavioural sections | 10,772 | 10,772 | kept on purpose |
| **Total** | **92,061 (~23,015 tok)** | **45,748 (~11,437 tok)** | **50%** |

Tool JSON schemas add ~2,000 tokens on top; measured only by estimate so far.
Shipped `.describe()` text is a few hundred chars per tool — schemas are cheap and
were never the problem.

---

## Locked decisions

Do not re-litigate these.

- **Cut:** Team/Swarm (TeamCreate, TeamDelete, SendMessage), Cron (Create/Delete/List),
  Worktree tools (Enter/Exit), TodoWrite. Worktrees survive as a future `/worktree`
  slash command — same capability, zero model tokens.
- **Keep:** AgentTool (pi has no subagents at all; for a small-context open model,
  fanning reads into sub-contexts is its best defense), Plan mode, Skill, WebFetch,
  WebSearch, ToolSearch, Config, Advisor, Sleep.
- **Tasks:** v2 (TaskCreate/Get/Update/List) is the only task system. TodoWrite made
  the model rewrite the whole array on every status change — the main way weak models
  corrupt a task list. v2 is also *cheaper* (6,938 vs 9,114 chars).
- **System prompt:** keep the behavioural sections, trim only dead ones. pi gets away
  with ~400 tokens because it targets frontier models that already behave; open-weight
  models need more guidance, not less, and open models running well is the point of
  this fork.
- **pi integration:** **vendor the source**, not the published npm packages
  (`@earendil-works/pi-{ai,agent-core}` @0.84.3). Full control, no upstream release
  dependency, ability to strip providers.

---

## Phase 1 — `prompt-diet` ✅ DONE

18 files changed, +169 / −623. Suite **589 pass / 3 skip / 0 fail** (585 baseline + 4
new). `tsc --noEmit` clean. **Not committed.**

### Landed

- [x] **Guard rail** — `src/prompt-budget.test.ts` (new). Measures the real assembly
      path (`getAllBaseTools()` → `await tool.prompt()`, `getSystemPrompt()`,
      `loadMemoryPrompt()`). Fails with a full per-tool breakdown. Four ceilings:
      tools 28,000 · single tool 3,200 · memory 7,500 · system prompt 19,500.
- [x] **Tool cuts** via the `getAllBaseTools()` registry in `src/tools.ts` — *not*
      file deletion. Full token win, ~10-line diff, zero import breakage.
- [x] **`isTodoV2Enabled()` → `true`** (`src/utils/tasks.ts`). Was `!nonInteractive`,
      which silently gave headless `-p` the pricier, corruption-prone TodoWrite —
      exactly the mode evals run in. Real bug, fixed in passing.
- [x] **Descriptions compressed:**

| Tool | Before | After |
| --- | ---: | ---: |
| Bash | 9,808 | 2,660 |
| PowerShell | 6,736 | 3,049 |
| Agent | 5,234 | 2,308 |
| EnterPlanMode | 4,022 | 982 |
| Task suite (4) | 6,938 | 1,425 |
| ExitPlanMode | 1,849 | ~640 |
| Advisor | 2,014 | 1,117 |
| Read | 1,425 | ~876 |
| Edit | 1,095 | ~772 |

- [x] **Auto-memory block** 12,581 → 7,229 (`memdir/memoryTypes.ts`, `memdir/memdir.ts`).
      Taxonomy section 7,216 → 3,109, keeping all four types and one example each.
- [x] **Registry tests updated** — `tools.test.ts`, `REPL.execution.e2e.test.tsx` now
      assert TaskCreate present / TodoWrite + swarm + cron + worktree absent.

### Deliberately NOT done

- [ ] **Batch `TaskCreate`** — approved, then dropped. Needs a union schema (ambiguity
      hurts weak models, the exact audience), plus output-schema and UI changes.
      Parallel tool calls already create N tasks in one turn; the prompt now says so.
      Reversible — revisit if the model actually serializes task creation.
- [ ] **Deleting the ~6,600 LOC** behind the cut tools (`TeamCreateTool/`,
      `ScheduleCronTool/`, `EnterWorktreeTool/`, `ExitWorktreeTool/`, `TodoWriteTool/`,
      `utils/teammateMailbox.ts`, `utils/cronScheduler.ts`, `utils/cronTasks.ts`).
      Zero token value — cosmetic only. Safe to do any time.

### Remaining headroom (~7k chars)

Config 2,763 (mostly *generated settings data*, poor ratio) · WebFetch 1,479 ·
WebSearch 1,327 · Skill 1,272 · AskUserQuestion 1,074 · LSP 1,039 · Grep 866.

Floor is not zero: the behavioural system prompt (~10,772) and the eval-validated
memory sections (~2,580) are deliberately irreducible.

---

## Phase 2 — `vendor-pi` ⬜

Purely additive. Nothing imports it; `check-types` must stay green throughout.

- [ ] Copy `shenanigans/pi/packages/ai` → `packages/pi-ai` (62,790 LOC, 39 providers,
      20 API adapters, OAuth, model catalog)
- [ ] Copy `shenanigans/pi/packages/agent` → `packages/pi-agent` (21,545 LOC, agent
      loop + harness + compaction + session)
- [ ] Wire both into the workspace (`package.json`, `turbo.json`, tsconfig paths)
- [ ] Reconcile `@anthropic-ai/sdk`: knightcode has 0.104.1, pi pins 0.91.1
- [ ] Add runtime deps: `@google/genai`, `openai`, `@aws-sdk/client-bedrock-runtime`,
      `partial-json`, `typebox`, `@smithy/node-http-handler`, `http-proxy-agent`,
      `https-proxy-agent`
- [ ] Confirm pi's `.ts`-extension ESM + erasable-syntax-only TypeScript builds under
      knightcode's bun/tsc setup — **this is the phase's main risk, and it surfaces
      here before anything depends on it**
- [ ] Smoke test importing one provider

Providers are lazy subpath imports (`api/*.lazy.ts`), so vendoring all 39 costs
nothing at runtime — only the one in use loads.

---

## Phase 3 — `pi-adapter` ⬜

One new file: `src/services/engine/piAdapter.ts`, behind `KNIGHTCODE_ENGINE=pi`.
The old path stays default until parity is demonstrated.

### Mapping A — pi `AssistantMessageEvent` → Anthropic `BetaRawMessageStreamEvent`

| pi | Anthropic |
| --- | --- |
| `start` | `message_start` |
| `text_start` / `text_delta` / `text_end` | `content_block_start` (`text`) / `content_block_delta` (`text_delta`) / `content_block_stop` |
| `thinking_start` / `thinking_delta` / `thinking_end` | `content_block_start` (`thinking`) / `content_block_delta` (`thinking_delta`) / `content_block_stop` |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | `content_block_start` (`tool_use`) / `content_block_delta` (`input_json_delta`) / `content_block_stop` |
| `done` / `error` | `message_delta` + `message_stop` |

`contentIndex` maps directly to Anthropic's block `index`.

### Mapping B — pi `AgentEvent` → knightcode generator yields

| pi | knightcode |
| --- | --- |
| `agent_start` | `RequestStartEvent` |
| `message_start` / `message_end` (assistant) | `AssistantMessage` |
| `message_start` / `message_end` (toolResult) | `UserMessage` with `tool_result` content |
| `message_update` | `StreamEvent` (via Mapping A) |
| `tool_execution_update` | `ProgressMessage` |
| `agent_end` | generator `return` → `Terminal` |

### Existing subsystems onto pi's loop hooks

pi's `AgentLoopConfig` hook surface is a superset of what `query.ts` needs.

| knightcode | pi hook |
| --- | --- |
| `canUseTool` (permissions) | `beforeToolCall` → `{ block, reason }` |
| Hooks (`utils/hooks.ts`) | `beforeToolCall` / `afterToolCall` |
| Compaction / microcompact | `transformContext` |
| Max-turns, stop hooks | `shouldStopAfterTurn` |
| Queued user input (steering) | `getSteeringMessages` |
| Model / effort switch mid-turn | `prepareNextTurn` |

### Tasks

- [ ] Write `piAdapter.ts` implementing both mapping tables
- [ ] Preserve the `query()` signature exactly — **if any UI file needs changing, the
      approach is wrong**
- [ ] Unit-test both mappings against pi's `faux` provider
      (`packages/ai/src/providers/faux.ts`) — no keys, no paid tokens
- [ ] Run `REPL.*.e2e.test.tsx` under both engines

### The 7 consumers that must keep working unchanged

`screens/REPL.tsx` · `cli/headlessQuery.ts` · `tasks/LocalMainSessionTask.ts` ·
`tools/AgentTool/runAgent.ts` · `utils/forkedAgent.ts` · `utils/handlePromptSubmit.ts` ·
`utils/hooks/execAgentHook.ts`

---

## Phase 4 — `pi-default` ⬜

- [ ] Flip the default engine to pi
- [ ] Delete `services/api/knightcode.ts` (3,468 LOC)
- [ ] Retire `utils/model/profile/` — pi-ai handles per-provider sampling, reasoning,
      and schema fixups natively. **Verify parity quirk-by-quirk before deleting**: it
      fixes a real, documented defect (see `knightcode-quality-diagnosis` memory).
- [ ] Retire `query.ts`'s retry/fallback machinery — pi has `utils/retry.ts`
- [ ] Headless `-p` diff against a real OpenRouter model, both engines

---

## Findings worth remembering

1. **ToolSearch is dead code.** `isToolSearchEnabledOptimistic()` is hardcoded `false`
   (`utils/toolSearch.ts` — the whole deferred-tool layer is a stub in this fork), so
   it ships 0 tokens. Its mechanism `defer_loading` is an Anthropic-only beta that
   gateways reject — `utils/api.ts` carries a kill switch because proxies return
   *"Extra inputs are not permitted"*. **It can never work over OpenRouter.** Kept only
   because it is free. Open question: delete it (~600 LOC) or leave the stub?

2. **Dead code was never the problem.** Import-reachability from `main.tsx` reaches
   1,588 of 1,806 files. Only 82 non-test files / 7,779 LOC are unreachable, and the
   SaaS commands (`teleport`, `stickers`, `passes`, `mobile`, …) are already 14-line
   stubs. Deleting all of it frees ~2% of the tree and **zero tokens**.

3. **pi has no subagent system.** Grepped and confirmed. "Orchestration" in pi means
   the session runtime (`agent-session.ts`), not multi-agent. AgentTool is a knightcode
   advantage to preserve, not a Claude Code artifact to strip.

4. **pi ships 8 tools total** — bash, edit, find, grep, ls, powershell, read, write —
   with 2,785 chars of description between them. That is the target register for prose,
   not a target for the tool *count*.

5. **Some prompt text is eval-validated.** `memoryTypes.ts` carries upstream notes like
   `0/2 → 3/3` on `WHAT_NOT_TO_SAVE`, `WHEN_TO_ACCESS`, and `TRUSTING_RECALL`. Those
   wordings were tuned against evals — do not compress them to hit a number. Two of the
   guard rail's ceilings were raised for exactly this reason.

---

## Open questions

- **ToolSearch:** delete (~600 LOC, and it can never work over OpenRouter) or keep the
  free stub?
- **Commit strategy:** Phase 1 is 18 files uncommitted on `cli-rewrite`. One commit, or
  split guard-rail / cuts / compression?
- **Eval before Phase 2?** Phase 1 changed every major tool description. A headless run
  against the favourite open models (nemotron, qwen3-coder, gpt-oss-120b) before/after
  would prove the diet did not degrade tool use — currently unverified beyond the suite.
