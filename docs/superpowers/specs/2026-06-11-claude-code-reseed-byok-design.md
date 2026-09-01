# KnightCode — claude-code Re-seed onto BYOK OpenRouter

**Date:** 2026-06-11
**Status:** Design — approved in principle, pending written-spec review
**Owner:** Raghav
**Supersedes (strategy):** the incremental phase-by-phase port implied by
`2026-05-30-byok-openrouter-cutover-design.md`. The *guiding principle* of that
spec (model-agnostic, claude-code-faithful harness) is retained and strengthened.

---

## 1. Decision in one sentence

Stop re-deriving claude-code piece by piece onto OpenTUI. Instead **re-seed
KnightCode from claude-code's own source as the trunk** — adopt its renderer,
agent loop, tools, UI, and commands largely verbatim — **swap only the model
transport to BYOK OpenRouter**, and **re-author the proprietary surface
(prompts, tool descriptions, branding) clean-room from the first release** so
every public npm version is legally defensible.

## 2. Why this is viable (the load-bearing findings)

The premise "just swap the model layer, keep the same harness and UI" is mostly
true, but three facts determine *how*:

1. **The Anthropic Beta Messages content-block format is the harness's internal
   data model, not merely its wire format.** `MessageParam`, `tool_use` /
   `tool_result` / `thinking` blocks, and streaming deltas flow through the
   query loop, every tool, and every `Message*` renderer (~140 files reference
   the SDK). OpenRouter speaks OpenAI format. **Resolution:** keep the `Beta*`
   types as the internal lingua franca (they ship in the public
   `@anthropic-ai/sdk` package, imported **types-only**), and translate at one
   edge. The "model layer" is therefore a real, hard *adapter* — not a stub.

2. **The renderer is a fork of MIT-licensed Ink, with pure-TypeScript
   reimplementations of its native pieces.** `src/ink` uses Ink's element model
   (`ink-box` / `ink-text`, Yoga layout, `<Box>`/`<Text>`); `src/native-ts`
   contains pure-TS reimplementations of `yoga-layout`, `color-diff`, and
   `file-index` — **no native binaries**. The renderer is portable and
   shippable. Adopting it (and sunsetting OpenTUI) is therefore the high-fidelity
   path with no platform-binary burden. The earlier memory note calling it
   "bespoke, not Ink" was wrong.

3. **The legal risk is narrow and identifiable, not codebase-wide.** It lives in
   the *proprietary surface*: system prompts, tool **descriptions**, and
   branding (names, ASCII art, URLs). The renderer (Ink/MIT) and harness
   mechanics (generic engineering) are not the risk. **Resolution:** continuous
   clean-room — re-author that surface from phase 1.

## 3. Decisions (locked)

| # | Decision |
|---|---|
| D1 | **npm publish is the goal.** Public, installable package. |
| D2 | **(Amended 2026-06-11)** **Keep OpenTUI as the renderer.** Build an **ink-compat layer** implementing claude-code's `src/ink.ts` barrel on `@opentui/react`; copy UI components near-verbatim against it. Do **not** ship claude-code's forked `src/ink`/`src/native-ts` (perf: OpenTUI native core beats the fork; legal: the fork delta is Anthropic-proprietary). |
| D3 | **claude-code source is the trunk.** Big-bang re-seed of a fresh CLI core; prior BYOK work re-grafts as edges. |
| D4 | **Continuous clean-room (track B).** Re-author prompts, tool descriptions, and branding from phase 1; no deferred end-pass. Every public release is defensible by construction. |
| D5 | **Rolling releases** — each phase ships a public version (v0.1 → v1.0). |
| D6 | **Keep essentially all of claude-code's feature surface**, including the SaaS-coupled parts, sequenced late behind a self-hostable relay. |
| D7 | **ultraplan is reimplemented locally** to claude-code parity or beyond (its current form is remote/CCR-coupled and cannot be copied). |

## 4. Subsystem boundary

### 4.1 SPINE — copy ~verbatim (the model-agnostic harness)
Renderer (`src/ink`, `src/native-ts/{yoga-layout,color-diff,file-index}`); agent
loop (`QueryEngine.ts`, `Task.ts`, `Tool.ts`, `src/query/*`); tool execution
(`src/services/tools/*`); tools (Bash/PowerShell, File{Read,Write,Edit}, Glob,
Grep, Todo, Task*, AskUserQuestion, NotebookEdit, Skill, WebFetch, MCP*, LSP);
UI (`src/components/*`, `src/screens/*`, `src/hooks/*`, `src/ink/components`);
slash commands (`src/commands/*`); memory/skills/styles (`src/memdir`,
`src/skills`, `src/outputStyles`, `src/keybindings`, `src/vim`); sessions/state/
schemas/constants/utils/migrations.

> **Clean-room caveat (D4):** "verbatim" applies to *mechanics*. Any file whose
> content is a **prompt, a tool description string, or branding** is re-authored
> as it is brought in, even within spine files.

### 4.2 MODEL SEAM — rewrite (the one genuinely hard component)
- `src/services/api/client.ts` → **OpenRouter client**: key from local config,
  base URL; remove OAuth / Bedrock / Vertex / Foundry branches.
- `src/services/api/claude.ts` → **keep** prompt assembly + `Beta*` types;
  **replace** the stream call with an `OpenAI-SSE → BetaRawMessageStreamEvent`
  translator covering tool-call deltas, thinking, finish reasons, and usage.
- `src/utils/model/*` → OpenRouter model registry + curated shortlist +
  free-form override.
- `@anthropic-ai/sdk` retained as a **types-only** dependency.

### 4.3 EDGES — graft existing BYOK work
sqlite/Drizzle session store, onboarding wizard (OpenRouter key), OpenRouter
transport, `MODEL_SHORTLIST`. The `engine-scheduler` query-engine port (written
against OpenTUI) is **superseded by the verbatim Ink copy** but retained as a
reference for already-validated tool flags and behaviors.

### 4.4 STUB / NO-OP — referenced too widely to delete
Telemetry / OpenTelemetry / analytics / `diagnosticTracking`; rate-limits /
`claudeAiLimits` / `policyLimits`; OAuth / `utils/auth` (→ BYOK key only). Hollow
implementations so imports resolve.

### 4.5 KEEP, sequenced late + **self-hostable relay**
`src/bridge`, `src/remote`, `src/server`, `src/upstreamproxy`, the teams cluster
(`SendMessageTool`, `ListPeersTool` [rebuild — empty in leak], `TeamCreate/Delete`,
`InProcessTeammateTask`, `RemoteAgentTask`), `RemoteTriggerTool`,
`settingsSync` / `teamMemorySync` / `remoteManagedSettings`. These are client
halves of a client↔server protocol whose server was not leaked. **KnightCode
ships its own self-hostable relay** (WebSocket relay + session registry + auth).
In-process teammates (same machine) work before the relay; cross-device peers
and `/remote-control` require it.

### 4.6 KEEP local
`src/voice`, `src/buddy` (companion duck), `ScheduleCronTool`, plan mode
(`EnterPlanModeTool` / `ExitPlanModeTool`).

### 4.7 REIMPLEMENT locally, ≥ claude-code
**ultraplan** — a dedicated heavier planning pass run by a **local** planning
subagent (not remote CCR dispatch), surfacing an approvable plan through the
existing ExitPlanMode permission flow.

### 4.8 DROP — empty stubs in the leak (off by default; "rebuild-if-wanted")
`TungstenTool`, `SnipTool`, `REPLTool`, `MonitorTool`, `PushNotificationTool`,
`SubscribePRTool`, `SuggestBackgroundPRTool`, `SendUserFileTool`, `src/ssh`.
Marked *"not included in the leaked source."* Keeping any **as a feature** is a
from-scratch build, not a port.

## 5. The model adapter (detail — this is the critical path)

Single bidirectional translator at the seam:

- **Outbound:** assembled `BetaMessageStreamParams` (system, messages, tools,
  tool_choice) → OpenAI `chat/completions` request. Map tools → `tools`
  (function schema), `tool_choice`, content blocks → OpenAI message parts.
- **Inbound:** OpenRouter SSE chunks → ordered `BetaRawMessageStreamEvent`
  sequence: `message_start` → `content_block_start/delta/stop` (text, tool_use
  with incremental JSON args, thinking where the model exposes it) →
  `message_delta` (stop_reason mapped from OpenAI `finish_reason`) →
  `message_stop`; `usage` mapped from OpenAI usage.
- **Caching/beta headers:** Anthropic prompt-cache controls are dropped or
  mapped to OpenRouter equivalents where they exist; absence must degrade
  gracefully (no harness assumption that caching exists).

Risks: tool-call argument streaming differs (OpenAI streams partial JSON
strings); thinking/reasoning exposure varies by model; stop-reason taxonomy
mismatch. These are the acceptance focus of phase B.

## 6. Sequencing — rolling releases, each phase = a public version

| Ver | Phase | Ships | Clean-room scope this phase |
|---|---|---|---|
| v0.1 | A | Ink renderer + agent loop boot; echo tool | branding shell |
| v0.2 | B | **OpenRouter adapter** — real turns stream → Beta blocks → render | (mechanics) |
| v0.3 | C | Core tools + permission loop | tool descriptions for shipped tools |
| v0.4 | D | Sessions + sqlite store + memory + skills + slash commands | memory/skill prompts |
| v0.5 | E | MCP + WebFetch + remaining safe tools | their tool descriptions |
| v0.6 | F | Subagents (AgentTool) + plan mode + **ultraplan (local reimpl)** | agent + plan + ultraplan prompts |
| v0.7 | G | Local features: voice, buddy, cron | feature copy/branding |
| v0.8 | H | Teams / multi-agent — in-process teammates first (ListPeers rebuilt) | teammate prompts |
| v0.9 | I | bridge / remote / server / `/remote-control` behind self-hostable relay | — |
| v1.0 | J | npm hardening + public launch polish | final branding sweep |

Each phase: its own branch + PR; **code-only commits** per finished phase (specs
and plans stay uncommitted, per project workflow). Each phase gets its own
implementation plan via the writing-plans flow before code is written.

## 7. Definition of done per phase

A phase ships when: it builds and boots under Bun on Windows + macOS/Linux; the
features it introduces work in a manual TUI smoke; the clean-room scope for that
phase contains **no verbatim Anthropic prompt/description/branding text**; and a
version is published to the public npm channel.

## 8. Open risks / to confirm during planning

- **R1 — OpenTUI sunset blast radius.** Quantify how much current
  `packages/cli` (screens, providers, hooks) is OpenTUI-bound and must be
  dropped vs. salvaged as edges before phase A.
- **R2 — Adapter fidelity ceiling.** Some claude-code behaviors assume Anthropic
  server-side features (server tools, fine-grained cache control, exact
  stop-reason semantics). Catalogue which gracefully degrade vs. need local
  emulation.
- **R3 — Relay scope (phases H/I).** The self-hostable relay is a separate
  product surface; it may warrant its own spec rather than living inside a phase
  plan.
- **R4 — Continuous clean-room throughput.** Re-authoring prompts/descriptions
  every phase is real ongoing work; budget it explicitly in each phase plan so
  it is not skipped under time pressure (it is the publish gate).
- **R5 — Build tooling.** claude-code's `MACRO.*` build defines and `stubs/`
  packages must be reconciled with KnightCode's turbo/changesets setup.
