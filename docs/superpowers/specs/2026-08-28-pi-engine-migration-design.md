# KnightCode → pi engine, Claude Code skin — Design

**Date:** 2026-08-28
**Branch base:** `cli-rewrite`
**Status:** approved design, numbers corrected by measurement, not yet implemented
**Convention:** per `ROADMAP.md`, specs/plans are never committed. Code only.

> **Revision note.** The first draft of this spec estimated token costs by measuring
> `prompt.ts` files on disk. Those figures were wrong — roughly 2x too high — because a
> `prompt.ts` holds multiple exports, imports, and conditional branches, only some of
> which reach the wire. Every number below was produced by **executing** the harness's
> own assembly path (`getAllBaseTools()` → `await tool.prompt(...)`, and
> `getSystemPrompt()`) under bun. Corrections are called out inline.

## Measured baseline

Interactive session (35 enabled tools):

| Source | Chars | Tokens | Note |
| --- | ---: | ---: | --- |
| Tool descriptions | 67,841 | ~16,960 | measured, not estimated |
| System prompt | 24,220 | ~6,055 | of which auto-memory is 12,581 |
| Tool JSON schemas | ~8,000 | ~2,000 | estimated; not yet measured |
| **Floor** | | **~25,000** | |

Headless (`-p`, 32 tools) is 70,017 chars / ~17,504 tokens — slightly *higher*, because
`isTodoV2Enabled()` is `!nonInteractive`, so headless ships `TodoWrite` (9,114 chars)
instead of the cheaper Task suite (6,938 chars).

**Correction to draft 1:** the floor is ~25k, not ~36k. Tool prose is ~17k, not ~31k.

### System prompt composition (measured)

| Section | Chars |
| --- | ---: |
| `# auto memory` | **12,581** |
| `# Doing tasks` | 3,287 |
| `# Executing actions with care` | 2,836 |
| `# System` | 1,625 |
| `# Using your tools` | 1,621 |
| intro | 834 |
| `# Output efficiency` | 730 |
| `# Tone and style` | 672 |
| dynamic boundary marker | 34 |

**The single largest item in the entire request is the auto-memory instruction block**
— 12,581 chars, ~3,145 tokens, 13% of the whole floor, spent teaching the model how to
use a memory directory. It is a fixed template (verified: headings are `## Types of
memory`, `## How to save memories`, `## When to access memories`, …), not user content.
It also sits *after* `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, so it never gets the stable cache
prefix. Claude Code's own equivalent instructions cover the same ground in ~2,000 chars.

**This was missing from draft 1 entirely and is the single biggest available win.**

## Three findings that change decisions

1. **`ToolSearch` never ships.** `isToolSearchEnabledOptimistic()` is hardcoded `false`
   (`utils/toolSearch.ts` — the whole deferred-tool layer is a stub in this fork), so
   `getAllBaseTools()` excludes it and it costs 0 tokens today. It was kept on the
   understanding that it works; it does not. Worse, its mechanism (`defer_loading`) is an
   Anthropic-only beta that proxies reject — `utils/api.ts` has a kill switch
   (`KNIGHTCODE_CODE_DISABLE_EXPERIMENTAL_BETAS`) precisely because gateways return
   "Extra inputs are not permitted". It can never work over OpenRouter. **Recommend:
   delete rather than keep.** Needs a decision.

2. **No task-tool double-shipping.** `TodoWrite.isEnabled()` returns false when v2 is on,
   so only one system ever ships. Draft 1 claimed otherwise — wrong.

3. **Task v2 is already cheaper than v1** (6,938 vs 9,114 chars) *and* avoids the
   whole-array-rewrite corruption mode. The decision to consolidate on v2 is right for two
   independent reasons.

## Problem

Even at the corrected ~25k, the floor is large: on a 200k model that is 12.5% of the
window every turn. Open-weight models on OpenRouter mostly do not get prompt caching, so
it is also paid in latency and cash on every request. Making open models work well is
this project's stated goal, so this is the primary defect.

pi (`shenanigans/pi`) does the same job for ~1,100 tokens: 8 tools with one-sentence
descriptions (2,785 chars total) and a ~400-token system prompt.

**Dead code is not the problem.** Import-reachability from `main.tsx` reaches 1,588 of
1,806 files. Only 82 non-test files / 7,779 LOC are unreachable, and the Anthropic-SaaS
commands (`teleport`, `stickers`, `passes`, `mobile`, ...) are already 14-line stubs.
Deleting all of it frees ~2% of the tree and **zero tokens**.

## Goals

1. Cut the floor from ~25k to **~8k tokens** (~68%) without losing wanted capability.
2. Replace the Claude-only inference path with pi's multi-provider layer (39 providers).
3. Keep the Claude Code UI (`src/tui` 20k LOC + `src/components` 63k LOC) **untouched**.

## Non-goals

- Adopting pi's TUI.
- Matching pi's 8-tool surface. AgentTool and the task system are kept deliberately — pi
  lacks both, and both matter more for weak models than for frontier ones.
- Cutting the behavioral system prompt to pi length (see 1e).

## Key architectural finding

`query()` is a **single async generator with 7 consumers**:

```
src/screens/REPL.tsx                 src/tools/AgentTool/runAgent.ts
src/cli/headlessQuery.ts             src/utils/forkedAgent.ts
src/tasks/LocalMainSessionTask.ts    src/utils/handlePromptSubmit.ts
                                     src/utils/hooks/execAgentHook.ts
```

```ts
export async function* query(params: QueryParams):
  AsyncGenerator<StreamEvent | RequestStartEvent | Message
                 | TombstoneMessage | ToolUseSummaryMessage, Terminal>
```

`BetaRawMessageStreamEvent` appears in exactly **two** files:
`services/api/knightcode.ts` (producer) and `types/message.ts` (declaration). UI consumers
only match `event.type === 'stream_event'`; `REPL.tsx` and `Messages.tsx` touch delta
shapes on one line each. Everything else renders the accumulated `AssistantMessage`.

**The engine swap is a single-seam replacement.** Preserve that signature; no UI changes.

---

## Subsystem 1 — Prompt diet

### 1a. Tool cuts (measured, interactive baseline)

| Tool(s) | Chars | Tokens | Backing code also deleted |
| --- | ---: | ---: | --- |
| TeamCreate 6,796 + SendMessage 1,297 + TeamDelete 627 | 8,720 | ~2,180 | `utils/teammateMailbox.ts` (1,183), swarm utils |
| CronCreate 2,940 + CronDelete 171 + CronList 110 | 3,221 | ~805 | `utils/cronScheduler.ts` (565), `utils/cronTasks.ts` (458) |
| ExitWorktree 1,923 + EnterWorktree 1,339 | 3,262 | ~816 | `utils/worktree.ts` (1,452) |
| **Interactive total** | **15,203** | **~3,801** | |
| TodoWrite (headless only; already off interactively) | 9,114 | ~2,279 | `tools/TodoWriteTool/` (300) |

Plus 9 inert stubs (0 tokens, ~100 LOC of tree noise): `Snip`, `Brief`, `SendUserFile`,
`Monitor`, `ReviewArtifact`, `WebBrowser`, `Workflow`, `REPL`, `Tungsten`.

**Correction to draft 1:** cuts free ~3,801 interactive tokens, not ~7,273. Draft 1
double-counted TodoWrite (already disabled interactively) and ToolSearch (never ships).

**Worktrees are not lost** — they become a `/worktree` slash command. Same capability,
zero model tokens. `utils/worktree.ts` keeps only what the command needs.

### 1b. Keeps

Remaining after cuts: **30 tools, 52,638 chars (~13,160 tokens)**.

Self-gating tools cost nothing when idle: `LSP` (needs a language server on PATH — it
*is* enabled on this machine, 1,039 chars), `Advisor` (needs a reviewer model; currently
enabled at 2,014 chars), MCP resource tools (need an MCP server).

- **Core file/shell (7):** Bash, Read, Edit, Write, Grep, Glob, PowerShell
- **Delegation (3):** Agent, TaskStop, TaskOutput — background-agent control, *not* todos
- **Tasks (4):** TaskCreate, TaskGet, TaskUpdate, TaskList
- **Plan mode (2):** EnterPlanMode, ExitPlanMode
- **Web (2):** WebFetch, WebSearch
- **Kept on request (3):** Config, Advisor, Sleep — *plus ToolSearch, pending finding #1*
- **Conditional (5):** LSP, NotebookEdit, ListMcpResources, ReadMcpResource, MCPTool
- **Interaction (1):** AskUserQuestion
- **Skills (1):** Skill

### 1c. Prompt rewrite

Rewrite every surviving description to pi length (1–2 sentences; no examples, no
`<reasoning>` blocks, no when-to-use essays). Reference for tone and length:
`shenanigans/pi/packages/coding-agent/src/core/tools/*.ts`.

The biggest single targets, measured:

| Tool | Now | Target |
| --- | ---: | ---: |
| Bash | 9,808 | ~350 |
| PowerShell | 6,736 | ~350 |
| Agent | 5,234 | ~1,600 |
| EnterPlanMode | 4,022 | ~400 |
| Config | 2,763 | ~250 |
| TaskCreate | 2,399 | ~300 |
| TaskUpdate | 2,243 | ~250 |
| Advisor | 2,014 | ~200 |
| remaining 22 | ~17,400 | ~5,300 |
| **Total** | **52,638** | **~9,000** (~2,250 tok) |

AgentTool keeps ~1,600 chars rather than ~350 because its description must still enumerate
the available subagent types and their tool access — that is data, not prose.

### 1d. Task consolidation

Task v2 becomes *the* task system:
- Delete `tools/TodoWriteTool/`.
- Delete the `isTodoV2Enabled()` flag; task tools become unconditional. **This also fixes
  the headless regression** where `-p` silently ships the more expensive, more
  corruption-prone v1.
- `TaskCreate` accepts a single task **or an array**, so bulk creation stays one call
  (v1's only genuine advantage).
- Strip swarm coupling: the teammate branch in `getTaskListId()` and the teammate
  semantics of `owner`. `owner` itself is retained for AgentTool subagent attribution.

### 1e. System prompt

Two separable pieces, treated differently.

**Auto-memory block: compress 12,581 → ~2,000 chars (~3,145 → ~500 tokens).** This is
pure mechanical instruction — file format, when to write, what not to save. It has none of
the behavioral value that justifies the rest of the prompt, and it is the largest single
item in the request. Highest value-per-risk change available.

**Behavioral sections: keep, trim dead branches only** (11,639 → ~9,500 chars). pi gets
away with 400 tokens because it targets frontier models that already behave. Open-weight
models need *more* instruction, not less — and open models running well is the whole point
of this fork. `# Executing actions with care` (2,836), `# Doing tasks` (3,287), and
`# System` (1,625) carry the destructive-action confirmation policy, the anti-gold-plating
rules, and security guidance. Not worth the risk.

Remove only: sections for deleted features (swarm/cron/worktree tool policy), the
`isReplModeEnabled()` branch, Anthropic-SaaS help text, and the `TODO_WRITE_TOOL_NAME`
branch in `getUsingYourToolsSection`.

Also fix while here: `DEFAULT_AGENT_PROMPT` reads "You are an agent for KnightCode,
KnightCode's official CLI for KnightCode" (`constants/prompts.ts:207`) — garbled by the
rebrand sweep.

### Result

| | Now | After |
| --- | ---: | ---: |
| Tool descriptions | ~16,960 | ~2,250 |
| Auto-memory block | ~3,145 | ~500 |
| Behavioral system prompt | ~2,910 | ~2,375 |
| Schemas | ~2,000 | ~2,000 |
| **Floor** | **~25,000** | **~7,100** |

**~72% reduction, no wanted capability lost.**

---

## Subsystem 2 — Vendor pi

`shenanigans/pi/packages/{ai,agent}` → `packages/pi-ai`, `packages/pi-agent`, as
first-party workspace packages.

- `pi-ai`: 62,790 LOC, 39 providers, 20 API adapters, OAuth, model catalog
- `pi-agent`: 21,545 LOC, agent loop + harness + compaction + session

Vendoring (not the published `@earendil-works/pi-{ai,agent-core}` @0.84.3) was chosen
deliberately: full control, no upstream release dependency, ability to strip providers.

Providers are lazy subpath imports (`api/*.lazy.ts`), so all 39 cost nothing at runtime.
New runtime deps: `@google/genai`, `openai`, `@aws-sdk/client-bedrock-runtime`,
`partial-json`, `typebox`, `@smithy/node-http-handler`, `http-proxy-agent`,
`https-proxy-agent`. `@anthropic-ai/sdk` is already present (0.104.1 vs pi's pinned
0.91.1 — version reconciliation is a step-2 task).

pi source is `.ts`-extension ESM using erasable-syntax-only TypeScript. Confirm it builds
under knightcode's bun/tsc setup before wiring anything. Step 2 is **purely additive** —
nothing imports it and `check-types` must stay green.

---

## Subsystem 3 — The adapter

One new file: `src/services/engine/piAdapter.ts`.

### pi `AssistantMessageEvent` → Anthropic `BetaRawMessageStreamEvent`

| pi | Anthropic |
| --- | --- |
| `start` | `message_start` |
| `text_start` / `text_delta` / `text_end` | `content_block_start` (`text`) / `content_block_delta` (`text_delta`) / `content_block_stop` |
| `thinking_start` / `thinking_delta` / `thinking_end` | `content_block_start` (`thinking`) / `content_block_delta` (`thinking_delta`) / `content_block_stop` |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | `content_block_start` (`tool_use`) / `content_block_delta` (`input_json_delta`) / `content_block_stop` |
| `done` / `error` | `message_delta` + `message_stop` |

`contentIndex` maps directly to Anthropic's block `index`.

### pi `AgentEvent` → knightcode generator yields

| pi | knightcode |
| --- | --- |
| `agent_start` | `RequestStartEvent` |
| `message_start` / `message_end` (assistant) | `AssistantMessage` |
| `message_start` / `message_end` (toolResult) | `UserMessage` with `tool_result` content |
| `message_update` | `StreamEvent` (table above) |
| `tool_execution_update` | `ProgressMessage` |
| `agent_end` | generator `return` → `Terminal` |

### Existing subsystems onto pi's loop hooks

| knightcode | pi `AgentLoopConfig` hook |
| --- | --- |
| `canUseTool` (permissions) | `beforeToolCall` → `{ block, reason }` |
| Hooks (`utils/hooks.ts`) | `beforeToolCall` / `afterToolCall` |
| Compaction / microcompact | `transformContext` |
| Max-turns, stop hooks | `shouldStopAfterTurn` |
| Queued user input (steering) | `getSteeringMessages` |
| Model/effort switch mid-turn | `prepareNextTurn` |

pi's hook surface is a superset of what `query.ts` needs.

### Retired by this

- `services/api/knightcode.ts` (3,468 LOC)
- `utils/model/profile/` — pi-ai handles per-provider sampling, reasoning, and schema
  fixups natively. **Verify parity per-quirk before deleting**; it fixes a real documented
  defect.
- Most of `query.ts`'s retry/fallback machinery — pi has its own (`utils/retry.ts`).

---

## Sequencing

Four independently shippable steps, each green on
`bun --cwd packages/cli run check-types` and `bun --cwd packages/cli test`.

1. **`prompt-diet`** — tool cuts, description rewrites, task consolidation, auto-memory
   compression, system-prompt trim. Delivers the entire token win. Zero engine risk.
2. **`vendor-pi`** — copy packages in, wire workspace, confirm build. Additive only.
3. **`pi-adapter`** — `piAdapter.ts` behind `KNIGHTCODE_ENGINE=pi`. Old path stays default.
4. **`pi-default`** — flip default, delete the old transport and redundant quirks layer.

## Testing

- **Step 1:** existing suite green (543 pass / 0 fail baseline). `brand-leak.test.ts` is
  the branding policy — rewritten prompts must comply. **Add a token-floor regression
  test** that runs the real assembly path (`getAllBaseTools()` → `await tool.prompt()`,
  `getSystemPrompt()`) and asserts total chars stay under threshold — the same harness
  used to produce this spec's numbers, so it cannot silently regress.
- **Step 2:** `check-types` green; smoke test importing one provider.
- **Step 3:** adapter unit tests over both mapping tables using pi's `faux` provider
  (`packages/ai/src/providers/faux.ts`) — no keys, no paid tokens. Then
  `REPL.*.e2e.test.tsx` under both engines.
- **Step 4:** headless `-p` against a real OpenRouter model, both engines, diffed.

## Risks

| Risk | Mitigation |
| --- | --- |
| Rewritten descriptions degrade tool use | Token-floor test + headless eval on the user's favourite open models before/after |
| Compressed memory prompt breaks memory writes | It is mechanical instruction; verify with a memory-write e2e before/after |
| pi source will not build under knightcode's tsc/bun | Step 2 is standalone and additive; found before any wiring |
| `utils/model/profile/` fixes a defect pi-ai does not cover | Verify parity per-quirk; keep behind the engine flag until proven |
| Adapter drops an event the UI needs | Both engines behind a flag; e2e suite runs against both |

## Open question

**ToolSearch** (finding #1) is a non-functional stub whose mechanism cannot work over
OpenRouter. It was kept on the understanding that it works. Delete it, or keep the stub?
Deleting costs nothing today and removes ~600 LOC.
