# Knightcode vs Claude-Code — full capability audit

**Date:** 2026-06-16 · **not committed** (repo rule: docs/specs/plans never land in git).
Companion to `docs/harness-comparison.md` (engine plan, stale "today" column) and
`docs/harness-followup-2026-06-16.md` (engine status + the read-before-edit / duplicate-call bugs).

This audit goes wider than the harness: it walks every dimension you named —
**AI harness, tools, skills, rules/memory, permissions/security, model/provider, MCP,
subagents, UI, slash commands, context assembly, background/scheduling, and quality-of-life** —
and states, per dimension, exactly what knightcode lacks relative to claude-code.

- Refs: `claude-code/src/...` (CC) and `packages/cli/src/...` / `packages/shared/src/...` (KC).
- Every "[n]" is a grep hit count taken from the current tree on 2026-06-16.
- **Legend:** ❌ missing · ⚠️ partial/weaker · ✅ present (parity) · 🚫 intentional skip (BYOK/scope).

---

## 0. Scale at a glance

| | knightcode | claude-code |
|---|---|---|
| Tools | **24** | **~70** |
| Slash commands | **31** | **~90** |
| Hook events | **5** | **~15** |
| Permission model | Bash allowlist only | allow/deny/ask rule grammar |
| Model provider | OpenRouter BYOK, single model | Anthropic, fallback chain + fast mode |
| MCP | none | full client stack |
| LSP | none | `LSPTool` + lsp service |
| Sandbox | none | bash sandbox + toggle |

knightcode is a lean BYOK/OpenRouter reimplementation. Much of CC's surface is
**legitimately out of scope** (Anthropic API betas, teams/swarms, remote/teleport,
voice, IDE bridge, analytics). This audit separates *those* (🚫) from **real gaps that
hurt output quality or daily usability** (❌/⚠️).

---

## 1. AI harness / engine loop

Covered in depth in `harness-followup-2026-06-16.md`. Summary of what KC's engine
(`lib/engine/`) still lacks vs CC's `query.ts`:

| Gap | KC | CC | Sev |
|---|---|---|---|
| In-loop compaction (microcompact + autocompact between tool rounds) | ❌ only UI-driven `hooks/compact-history.ts`, outside the loop | `query.ts:379-467` ordered pipeline every round | **High** |
| Recovery: stream-error retry+backoff | ❌ error → throws → terminal `error` (`query.ts:309`) | `services/api/withRetry.ts` (10 retries) | **High** |
| Recovery: reactive compaction on context overflow | ❌ overflow kills the turn | `query.ts:1119-1175` | **High** |
| Recovery: max_output_tokens resume, empty-response retry, withhold-then-recover | ❌ | `query.ts:1082-1256` | Med |
| Terminal reason granularity | ⚠️ 4 reasons (`complete/aborted/max_rounds/error`) | 10 typed reasons | Low |
| Streaming tool executor (start tools mid-stream) | ❌ (post-stream scheduler only) | `StreamingToolExecutor.ts` | Low |

**Read-before-edit / file-state ledger and duplicate-call dedup** are the two correctness
bugs detailed in the follow-up doc — both still open, neither in the original plan.

---

## 2. Tools — capability gaps

KC has the core editing/search/web/task set. Missing tool *capabilities* (not just SKIP-tier):

| Tool / capability | KC | CC | Notes |
|---|---|---|---|
| **LSP integration** (`LSPTool`) | ❌ [0 hits] | ✅ go-to-def, diagnostics, hover via language servers | Real gap: KC has no semantic code intelligence; relies on grep/read. |
| **Worktree tools** (`EnterWorktree`/`ExitWorktree`) | ❌ [0] | ✅ isolated parallel work | Useful for parallel agents; KC agents share the workspace. |
| **REPL / notebook exec** (`REPLTool`) | ❌ | ✅ | KC has NotebookEdit (edit only), no execution. |
| **Image input** (paste/screenshot) | ❌ [0] | ✅ | KC Read returns image base64 but the user can't paste images into the prompt. |
| **MCP tools** (dynamic) | 🚫 none | ✅ MCP/ListMcpResources/ReadMcpResource/McpAuth | See §7. |
| **Computer use / web browser** (`WebBrowserTool`, chrome) | 🚫 | ✅ | Out of scope. |
| **Sleep / scheduling tools** (`SleepTool`, `ScheduleCronTool`) | ❌ | ✅ | KC has no autonomous wait/cron. |
| **Send-message / push-notification** (`SendMessageTool`, `PushNotificationTool`) | ❌ | ✅ | Inter-agent + mobile surfaces; mostly out of scope. |
| Web search/fetch | ✅ | ✅ | Parity. |
| Task suite (Create/Get/List/Output/Stop/Update) | ✅ | ✅ | Parity (local). |
| **Per-tool result-size budget + truncation hint** | ❌ blanket constants (`tools/shared/constants.ts`) | `Tool.ts:466` per-tool budget + disk spill | Drives re-runs (see follow-up §4.4). |

---

## 3. Skills

KC's skill system is **better than first glance** — it loads bundled **and** user/project
skills (`lib/context/skills/skills.ts:208`: `~/.knightcode/skills/<name>/SKILL.md` and
`.knightcode/skills/<name>/SKILL.md`), parses frontmatter, builds a system-prompt index
(`buildSkillIndex`), and exposes a `Skill` tool that loads bodies on demand with
`disableModelInvocation` + dynamic-body support (`tools/Skill/execute.ts`).

| Aspect | KC | CC | Sev |
|---|---|---|---|
| Bundled skills | ⚠️ 8 (simplify, remember, stuck, verify, lorem, batch, skillify) | ~16 (adds claude-api, keybindings, loop, schedule, debug, updateConfig…) | Low |
| User/project skill loading | ✅ | ✅ | Parity. |
| **Automatic skill discovery / relevance prefetch** | ❌ model must read the index and choose to call `Skill` | `services/skillSearch` (signals/side-model surfaces relevant skills per turn) | **Med** — KC under-uses skills because nothing nudges them. |
| **Plugin system** (`src/plugins`, bundled plugins, marketplace) | ❌ [0] | ✅ install/reload plugins, bundled plugin packs | Med — no third-party skill/command distribution. |
| Skill progress rendering | ❌ runs silently | progress messages in transcript | Low |

---

## 4. Rules & memory

KC has a genuinely decent rules layer: `lib/context/rules.ts` loads **global + project**
rules with frontmatter (`name`/`description`/`paths`) — including **path-scoped rules**
(`paths:` globs) — plus `KNIGHTCODE.md` and `.knightcode/rules/`, with `@include`
processing and HTML-comment stripping (`file-discovery.ts`).

| Aspect | KC | CC | Sev |
|---|---|---|---|
| Project/global instructions file | ✅ `KNIGHTCODE.md` | ✅ `CLAUDE.md` | Parity. |
| Path-scoped rules with frontmatter | ✅ | ✅ | Parity (good). |
| **Nested per-directory instruction injection mid-turn** | ❌ rules loaded once into system prompt | CC injects nested `CLAUDE.md` as attachments as files are touched (`attachments.ts:1710`) | Med |
| **Automatic memory extraction** (learn facts across sessions) | ❌ [0: extractMemories/autoDream/SessionMemory] | ✅ `services/{extractMemories,autoDream,SessionMemory}` | Med — KC `/memory` is manual edit only. |
| `/memory` command | ⚠️ manual edit of KNIGHTCODE.md | ✅ structured memory + auto-dream | — |
| **Output styles** (personas/response formats) | ❌ [0] | ✅ `src/outputStyles`, `/output-style` | Low |

---

## 5. Permissions & security

**Biggest non-harness gap.** KC's entire permission model is a **Bash command allowlist**:
`permissions.ts` stores `{ allowedCommands: string[] }` with prefix matching
(`isCommandAllowed`), plus a session `alwaysAllowEdits` flag and the mode gate
(`tool-runner.ts:gateToolCall`). That's it.

| Aspect | KC | CC | Sev |
|---|---|---|---|
| **allow/deny/ask rule grammar** | ❌ only allowlist | ✅ `PermissionRule.ts` (allow/deny/ask), `alwaysAllow/Deny/AskRules` | **High** |
| Per-tool / glob-scoped file permissions | ❌ edits are all-or-nothing per session | ✅ rules scoped by tool + path pattern | **High** |
| **Bash sandbox** (network/fs isolation) | ❌ [1 weak hit] | ✅ `utils/sandbox`, `/sandbox-toggle`, `PowerShellTool` sandbox | **High** (security) |
| Command risk classifier | ⚠️ `permissions/command-risk.ts` exists (basic) | ✅ richer classifier + rules | Med |
| **Managed/enterprise settings** (admin-locked policy) | ❌ | ✅ `remoteManagedSettings`, `ManagedSettingsSecurityDialog` | Low (org feature) |
| **Trust dialog** (first-run folder trust) | ❌ | ✅ `TrustDialog` | Med (security) |
| Settings precedence (user/project/local/enterprise) | ⚠️ flat `settings.ts` (83 lines) | ✅ layered settings stack | Med |

---

## 6. Model & provider

| Aspect | KC | CC | Sev |
|---|---|---|---|
| Provider | OpenRouter BYOK, single model (`resolve-model.ts`) | Anthropic | 🚫 by design |
| Reasoning effort | ✅ (`reasoningEffort` → OpenRouter effort) | ✅ | Parity. |
| **Fallback model on overload** | ❌ [0] | ✅ `FallbackTriggeredError` chain | Med (OpenRouter already multi-routes, so partly mitigated) |
| **Fast mode** | ❌ | ✅ `/fast` | 🚫 Anthropic-specific |
| Model picker | ✅ `/models` | ✅ `/model` | Parity. |
| Prompt caching | 🚫 provider-managed | ✅ explicit cache discipline | 🚫 |

---

## 7. MCP

Entirely absent in KC [0 hits]. CC has a full client stack: `services/mcp`, MCP/
ListMcpResources/ReadMcpResource/McpAuth tools, `/mcp` command, transports (stdio/sse/ws),
elicitation. **Status: 🚫 deliberate** per the original spec — but it's the single largest
*extensibility* gap. Without MCP, KC can't pull in external tool servers (DBs, browsers,
SaaS) the way CC can. If KC ever wants an ecosystem, this is the lever.

---

## 8. Subagents / agents

KC has user-defined agents (`lib/agents/loader.ts` parses `.knightcode/agents/*.md`
frontmatter: name/description/tools/disallowedTools/model/maxTurns/background) and built-in
agents (`built-in.ts`), background agents with a notification FIFO (`Agent/notifications.ts`).

| Aspect | KC | CC | Sev |
|---|---|---|---|
| User-defined agents | ✅ | ✅ | Parity. |
| **Subagent runs the real engine loop** | ❌ bespoke `generateText` + `run-subagent.ts` (`Agent/execute.ts:78,168`) | ✅ recursive `query()` | **High** — subagents get no compaction/recovery/hooks. |
| **Streaming subagent progress to UI** | ❌ `generateText` (non-streaming) — user sees nothing until it returns | ✅ progress tagged `agentId` | **High** (UX) |
| Parallel subagents | ⚠️ Agent is concurrency-safe so scheduler *can* parallelize, but inner loop is blocking | ✅ | Med |
| Inherited permission policy | ⚠️ mode hardcoded `"BUILD"` (`Agent/execute.ts`) | ✅ inherits parent context | Med |
| Model override per spawn | ✅ `resolve-subagent-model.ts` | ✅ | Parity. |

---

## 9. UI / rendering

KC has one generic `components/messages/tool-call-view.tsx` for **every** tool, plus a
diff view that's only used in permission dialogs.

| Aspect | KC | CC | Sev |
|---|---|---|---|
| **Per-tool renderers** (Bash exit codes, structured diffs in transcript, etc.) | ❌ one generic view | ✅ `Tool.ts:566-659` render methods per tool | **High** (readability) |
| **Grouped/collapsed read & search** | ❌ every call = its own row | ✅ `renderGroupedToolUse` | Med |
| **Live per-tool progress** (spinners, partial output per running tool) | ❌ global `working-indicator.tsx` only | ✅ per-tool progress streamed | Med |
| **Nested subagent activity** | ❌ (see §8 — hidden) | ✅ | Med |
| Diff rendering in transcript | ⚠️ `diff-view.tsx` exists but only in permission panel | ✅ inline in transcript | Med |
| Retry/recovery system rows | ❌ (no retries to show) | ✅ countdown rows | tied to §1 |
| Compaction boundary row | ✅ `compaction-message.tsx` | ✅ | Parity. |
| Interrupted-turn marker | ✅ `interrupted-message.tsx` + engine `isInterrupted` | ✅ | Parity. |
| Truncation expand affordance (`isResultTruncated`) | ❌ | ✅ | Low |

---

## 10. Slash commands

KC has 31; CC ~90. KC covers the essentials (agents, allow, clear, commit, commit-push-pr,
compact, copy, cost, doctor, exit, export, feedback, files, help, hooks, init, memory,
models, new, reasoning, rename, review, rewind, security-review, sessions, setup, stats,
status, theme, undo, branch). Notable **missing** that aren't pure-scope:

| Missing command | What it does in CC | Sev |
|---|---|---|
| `/mcp` | manage MCP servers | 🚫 (no MCP) |
| `/plugin`, `/reload-plugins` | plugin management | Med |
| `/output-style` | response personas | Low |
| `/keybindings`, `/vim` | input customization | Med |
| `/usage`, `/context`, `/ctx_viz` | token/context inspection | Med |
| `/resume` | richer session resume/forking | Low (KC has `/sessions`) |
| `/add-dir` | multi-root workspaces | Med |
| `/export`, `/share` | KC has `/export`; no `/share` | Low |
| `/install-github-app`, `/pr_comments`, `/autofix-pr`, `/issue` | deep GitHub integration | Med |
| `/diff` | standalone diff viewer | Low |

---

## 11. Context assembly

(From `harness-comparison.md` §5; status as of the engine migration.)

| Aspect | KC | CC | Sev |
|---|---|---|---|
| **Per-round attachment injection** (changed-file diffs, todo reminders, date change) | ❌ only hook `systemMessage` reminders ride along (`query.ts:175`) | ✅ `getAttachmentMessages` each round | Med |
| **Volatile-context caching** | ❌ `buildRequestContext(cwd)` runs every round uncached (`query.ts:145`) | ✅ static frozen, volatile cached | Med (cost/latency) |
| **Incremental transcript→API conversion** | ❌ full `convertToModelMessages` every round (`query.ts:199`) | ✅ slices from last compact boundary | Med (cost/latency) |
| Deferred tools tracked in State | ✅ `loadedDeferred` (`query.ts:97`) | ✅ | Parity. |
| ToolSearch (load tool schemas on demand) | ✅ | ✅ | Parity. |

---

## 12. Background, scheduling & remote

| Aspect | KC | CC | Sev |
|---|---|---|---|
| Local background tasks | ✅ Task* tools + `lib/tasks` | ✅ | Parity (local). |
| **Cron / scheduled agents** | ❌ | ✅ `ScheduleCronTool`, `tasks/` | Low/Med |
| Remote agents / teleport / BG daemon sessions | 🚫 | ✅ | Out of scope (local CLI). |
| Teams / swarms / coordinator | 🚫 | ✅ | Out of scope. |

---

## 13. Quality-of-life / misc

| Aspect | KC | CC | Sev |
|---|---|---|---|
| Vim mode | ❌ [0] | ✅ `src/vim`, `/vim` | Med |
| Custom keybindings | ❌ [0] | ✅ `keybindings`, `/keybindings` | Med |
| Image paste in prompt | ❌ | ✅ | Med |
| Voice / dictation | 🚫 | ✅ | Out of scope. |
| IDE bridge (VS Code/JetBrains) | 🚫 | ✅ | Out of scope. |
| Cost/usage tracking | ✅ `/cost`, `/stats` | ✅ | Parity. |
| Doctor / health check | ✅ `/doctor` | ✅ | Parity. |
| Onboarding | ✅ | ✅ | Parity. |
| Auto-update | ✅ `lib/update` | ✅ | Parity. |
| Theme | ✅ `/theme` | ✅ | Parity. |

---

## 14. Prioritized verdict — what to close for the biggest quality lift

Ranked by impact on **output quality / reliability** (not effort), counting only ❌/⚠️
genuine gaps (🚫 scope items excluded):

1. **Engine recovery + in-loop compaction (§1).** Highest lever. Today long/overflowing
   turns die with no retry. Reliability ceiling on exactly the tasks a harness exists for.
2. **File-state ledger / read-before-edit + duplicate-call dedup** (follow-up doc). Visible
   correctness bugs; the Edit prompt currently *lies* about enforcement.
3. **Subagents on the real engine loop + streaming progress (§8).** Subagents currently get
   no compaction/recovery/hooks and are invisible while running.
4. **Permission rule grammar + sandbox (§5).** Security + ergonomics; the all-or-nothing
   edit grant and Bash-allowlist-only model are coarse and unsafe for untrusted repos.
5. **Per-tool UI renderers + grouped read/search (§9).** Big readability win, self-contained.
6. **Automatic skill discovery (§3) + per-round attachments/context caching (§11).** Makes
   skills actually get used and cuts token/latency cost.
7. **LSP (§2).** Semantic code intelligence; large effort, large payoff for code tasks.

**Deliberately deferred (🚫):** MCP, teams/swarms, remote/teleport, voice, IDE bridge,
Anthropic API betas (fast mode, cache-editing, task_budget), analytics. These are scope
decisions, not deficiencies — though **MCP** is the one worth revisiting if KC ever wants an
extension ecosystem.
