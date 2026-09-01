# KnightCode — BYOK / OpenRouter Local Cutover (v1)

**Date:** 2026-05-30
**Status:** Design — approved in principle, pending written-spec review
**Owner:** Raghav

---

## 1. Guiding principle

KnightCode should behave like claude-code. The harness — system prompt, tool
definitions, agent loop, token streaming, context assembly, compaction, and TUI
rendering — must be **model-agnostic and faithful to claude-code**, so that the
**output quality is a pure function of the chosen model** (cheap, free, or
frontier). BYOK OpenRouter is _only_ the transport. The vendored `claude-code/`
source tree is the fidelity source of truth; where behavior is ambiguous, we
mirror claude-code rather than invent.

This is the principle every downstream decision serves: nothing in the harness
may assume a specific provider or model family.

## 2. Goals (v1)

v1 ships KnightCode's **current feature set, made to stand on its own** — not new
claude-code features. It preserves what's implemented today (agent loop, tools,
skills, hooks, tasks, Build/Auto/Plan modes, sessions, dialogs), drops the SaaS
scaffolding that BYOK replaces (accounts, OAuth, billing, credits), and reworks
the architecture and UI. Reaching claude-code's fuller surface is the post-v1
roadmap, built on top of this release.

Concretely, a standalone, npm-publishable (Bun runtime) BYOK CLI:

1. **Pure-local architecture** — the hosted server, accounts, and billing are
   removed. The CLI runs entirely on the user's machine.
2. **Direct OpenRouter inference** with token streaming, using the user's key.
3. **Local persistence** of sessions, messages, usage, and config via
   `bun:sqlite` + a config file under `~/.knightcode/`.
4. **First-run onboarding wizard** (replaces OAuth login).
5. **Full UI revamp** — restructure the TUI to mirror claude-code's surfaces
   (input box, streaming message view, tool-call/diff rendering, status bar,
   dialogs), built on the existing OpenTUI/React stack (see §6.9).
6. **Model selection:** a curated shortlist of strong tool-callers plus
   free-form override (any OpenRouter model ID).
7. **Web tools:** WebFetch runs locally; WebSearch is optional via a
   bring-your-own search key and degrades gracefully when absent.

## 3. Non-goals (deferred to later phases)

- Full claude-code parity (v1 revamps the core UI surfaces; long-tail polish,
  animations, and every command/dialog continue iterating post-v1).
- Replacing `@ai-sdk/react` `useChat` with a hand-rolled agent loop.
- Any hosted/managed tier, accounts, billing, or credit metering.
- New claude-code capabilities not already implemented (extra slash commands,
  MCP, expanded tool surface); keyless WebSearch.

## 4. Current state (what we're cutting from)

KnightCode today is a hosted SaaS proxy, not BYOK:

- **CLI** (`packages/cli`, OpenTUI/React, Bun) runs the agent loop and executes
  tools locally, but routes inference through a remote server via a Hono RPC
  client (`apiClient`, `lib/api-client.ts`) using `@ai-sdk/react`'s
  `DefaultChatTransport`.
- **Server** (`packages/server`, Hono) is an auth gate (Clerk OAuth) + credit
  meter (Polar) + key vault + inference proxy. Routes: `chat`, `agent-step`,
  `compact`, `sessions`, `billing`, `web`, `auth`. Sentry-instrumented.
- **Database** (`packages/database`) is Prisma over **Postgres**
  (`DATABASE_URL`), consumed both by the server and directly by the CLI's
  dialogs.

### Coupling points (the surgery sites)

| Seam                | Where                                                                           | v1 replacement                                 |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Main inference      | `use-chat.ts:109` `DefaultChatTransport({ api: apiClient.chat })`               | `LocalChatTransport` → OpenRouter `streamText` |
| Compaction          | `use-chat.ts:395` `apiClient.compact.$post`                                     | local compaction fn                            |
| Session persistence | `use-chat.ts:699/718/784` `apiClient.sessions[:id].$patch`                      | local `bun:sqlite` store                       |
| Subagent step       | `tools/Agent/execute.ts:95` `apiClient["agent-step"].$post`                     | local subagent step fn                         |
| Direct DB reads     | dialogs (`sessions`, `stats`, `rename`, `doctor`) import `@knightcode/database` | local `bun:sqlite` store                       |
| Auth                | `lib/auth/*` (Clerk OAuth)                                                      | OpenRouter key onboarding + config             |

## 5. Target architecture

A single Bun CLI process. The only outbound network is: **OpenRouter**
(inference), an **optional search API** (WebSearch), and **arbitrary URLs**
(WebFetch). Everything else is local.

```
TUI (OpenTUI/React)
   │
   ▼
use-chat agent loop ──► LocalChatTransport ──► @openrouter/ai-sdk-provider ──► OpenRouter (stream)
   │                          ▲
   │                          └── resolveModel(modelId, reasoningEffort)
   ▼
tools execute locally (already do)
   │
   ▼
~/.knightcode/
   ├── knightcode.db      (bun:sqlite: sessions, messages, usage)
   └── config.json        (key, default model, optional search key)
```

## 6. Component design

### 6.1 Inference layer — `LocalChatTransport`

Implement a custom `ChatTransport<Message>` (the AI SDK extension point used by
`useChat`) that, instead of POSTing to an HTTP endpoint, calls
`streamText({ model: openrouter(modelId), system, messages, tools, providerOptions })`
and returns `result.toUIMessageStream()`. This **preserves `useChat`'s tool-loop
state machine** (`lastAssistantMessageIsCompleteWithToolCalls`), so the blast
radius is one file plus a model resolver. Tokens stream natively.

_Rejected alternative:_ ripping out `useChat` for a hand-rolled loop. More
faithful to claude-code long-term, but a large rewrite that belongs in a later
phase, not the v1 cutover.

Fidelity reference: `claude-code/src/cli/transports`, `claude-code/src/assistant`.

### 6.2 Model resolution & shortlist

A local `resolveModel(modelId, reasoningEffort)` replaces the server's
`lib/models.ts`. It returns `{ model, providerOptions }` built from
`@openrouter/ai-sdk-provider`, mapping reasoning effort to OpenRouter/provider
options where supported.

A **curated shortlist** lives in `@knightcode/shared` (so CLI and tooling share
it): a small set of vetted strong tool-callers spanning free → frontier, each
with a label and the canonical OpenRouter model ID. The shortlist is the
onboarding picker and the in-app model switcher; a **free-form override** (any
OpenRouter ID via config or the switcher) is always accepted. The exact list and
default are finalized at implementation time against live OpenRouter
availability; the default is a strong tool-caller, **not** assumed to be any
particular family (per §1).

### 6.3 Subagent loop (Agent tool)

`tools/Agent/run-subagent.ts` already injects the step function for testability;
today `execute.ts` wires it to `apiClient["agent-step"]`. Swap that injected
function for a local one that calls `streamText`/`generateText` directly via the
same model resolver. No protocol change — only the implementation of the
injected step.

Fidelity reference: `claude-code/src/commands/agents`, `claude-code/src/assistant`.

### 6.4 Compaction

Move `server/routes/compact.ts` logic into a local `compactConversation()`
function invoked where `apiClient.compact` is today (`use-chat.ts:395`). It is
just another inference call (summarize + preserve N recent messages) plus the
existing metadata bookkeeping (`isCompaction`, `originalMessageCount`,
`summaryCount`, `preservedCount`).

Fidelity reference: `claude-code/src/commands/compact`.

### 6.5 Web tools

- **WebFetch** — local: HTTP fetch + `html-to-text` (already a dependency).
  Move server `web.ts` fetch logic into `tools/WebFetch/execute.ts`.
- **WebSearch** — optional BYO key: a single search provider for v1 (provider
  chosen at implementation; pluggable interface). When no search key is
  configured, the tool returns a clear "WebSearch not configured" result and the
  agent proceeds without it (graceful degrade).

### 6.6 Local store — Drizzle ORM over `bun:sqlite`

Add a **CLI-local store module** (`packages/cli/src/lib/store/`) using **Drizzle
ORM over `bun:sqlite`**. The store is added in parallel and is the only DB the
CLI uses post-cutover; the old Prisma `packages/database` (consumed only by the
server today) is deleted during `strip-server`. The DB file
`~/.knightcode/knightcode.db` is opened with
`new Database(path, { create: true })` and wrapped via `drizzle-orm/bun-sqlite`;
migrations are generated by `drizzle-kit` and applied on startup.

_Rationale (from comparing opencode, the user-flagged reference):_ opencode runs
exactly this stack — it migrated _away from JSON files to SQLite_ and uses
Drizzle-over-`bun:sqlite` with a timestamped migration system
(`opencode/packages/opencode/src/storage/db.bun.ts`, `.../migration/`). Drizzle
is far lighter than Prisma for a published CLI (no query-engine binary, no heavy
generate step), gives type-safe queries and typed JSON columns, and provides the
migration workflow we'll rely on as the schema grows toward parity.

The store exposes typed functions (create/list/get/rename/delete session;
append/update message; usage rollups) replacing both the server `sessions`
routes and the CLI's direct Prisma reads. **Sessions are scoped by working
directory** (the local analog of the removed `userId`), so the sessions list
shows the current project's sessions — matching claude-code's per-project model.

### 6.7 Config & secrets

Two files under `~/.knightcode/`, matching the existing split:

- **Non-secret prefs** → existing `settings.json` via `lib/settings.ts`
  (`SUPPORTED_SETTINGS` already has `model`, `theme`, `defaultMode`,
  `reasoningEffort`). `defaultModel` = the `model` setting. No new file.
- **Secrets** → a new `0600` credentials file (`~/.knightcode/credentials.json`)
  via a new `lib/credentials.ts`, mirroring the existing `auth.ts` pattern
  (`0700` dir, `0600` file). Shape:
  `{ openRouterApiKey, searchProvider?, searchApiKey? }`.

```jsonc
// ~/.knightcode/credentials.json   (chmod 0600)
{
  "openRouterApiKey": "sk-or-...",
  "searchProvider": "brave",
  "searchApiKey": "...",
}
```

Precedence (highest first): environment variables (`OPENROUTER_API_KEY`,
`KNIGHTCODE_MODEL`, `KNIGHTCODE_SEARCH_PROVIDER`, `KNIGHTCODE_SEARCH_API_KEY`) →
credentials/settings files → built-in defaults. The Config tool/dialog edits
both (`claude-code/src/commands/config` as fidelity reference). Secrets are
`0600` and never written to session storage or logs.

### 6.8 Onboarding wizard

Replaces the OAuth login screen. First run (no key resolvable) launches a wizard:
prompt for OpenRouter key → validate against OpenRouter → pick a default model
from the shortlist → optionally add a search provider + key → write
`config.json`. Subsequent runs skip straight to the session UI. A
`knightcode`-native re-run path (e.g., via the existing Config command/dialog)
lets users change these later.

### 6.9 UI revamp (v1) & framework decision

**Framework decision: stay on OpenTUI (`@opentui/react`).** Evidence: claude-code
is _not_ built on Ink — its `package.json` pins React 19 + a bespoke
`react-reconciler` renderer (no `ink` dependency anywhere in its source).
OpenTUI is the same architectural family — a React reconciler rendering to the
terminal — so claude-code's component and hook patterns port to OpenTUI
directly. Shifting to Ink would be both a different paradigm _and_ a full rewrite
of every existing screen/dialog/provider, while pulling against the Bun +
`bun:sqlite` choices, with no fidelity gain. Staying on OpenTUI keeps the working
routing / providers / keyboard-layer / theme infrastructure and is the
lower-risk path to a publishable, claude-code-faithful UI.

**Revamp scope (v1):** a structural rebuild of the core surfaces to mirror
`claude-code/src`, not a cosmetic tweak:

- **Input box** — multiline prompt, mode indicator (Build/Auto/Plan), model +
  reasoning-effort display, slash-command menu.
- **Streaming message view** — smooth token streaming, markdown rendering, clear
  user / assistant / tool turn separation.
- **Tool-call & diff rendering** — collapsed-with-status by default, expandable
  to inputs/outputs; readable Edit/Write diffs.
- **Status bar / footer** — model, mode, token/cost, working state.
- **Dialogs** — sessions, config, doctor, stats, rename refreshed to the new
  visual language.
- **Per-agent model selection** — the Agent tool's `model` override is alias-based
  (`MODEL_ALIASES` in `@knightcode/shared`, surfaced as an enum the model picks
  from). In the revamp, give the _user_ a per-agent model picker (in the agents
  dialog / spawn flow) so a human can pin a specific OpenRouter model to a given
  subagent, independent of what the model auto-selects.

Each surface is built against `claude-code/src` as the layout/behavior
reference. Detailed per-surface design is produced in the Phase 5 plan.

### 6.10 Deletions

- `packages/server` — entire package (Clerk, Polar, credits, Sentry, all routes).
- CLI: `lib/auth/*` (OAuth), `lib/api-client.ts`, billing/credit UI, any
  credit/usage-billing fields surfaced in dialogs.
- Dependencies: Clerk, Polar, Sentry, Prisma/pg, Hono client usage in the CLI.

## 7. Data model (Drizzle / `bun:sqlite`)

Mirrors the current Prisma schema, minus multi-tenant/billing fields, plus a
`directory` scope and JSON-mode columns (Drizzle `text({ mode: "json" })`).
Epoch-ms integers for timestamps.

```ts
// session — one row per conversation, scoped to a working directory
export const sessionTable = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    directory: text().notNull(), // project scope (replaces userId)
    title: text().notNull(),
    model: text(), // last OpenRouter model id (nullable)
    reasoningEffort: text().notNull().default("medium"),
    timeCreated: integer().notNull(), // epoch ms
    timeUpdated: integer().notNull(),
  },
  (t) => [index("session_directory_idx").on(t.directory)],
);

// message — one row per turn; parts as a typed JSON column (matches AI SDK UIMessage)
export const messageTable = sqliteTable(
  "message",
  {
    id: text().primaryKey(),
    sessionId: text()
      .notNull()
      .references(() => sessionTable.id, { onDelete: "cascade" }),
    role: text().notNull(),
    parts: text({ mode: "json" }).notNull().$type<UIMessagePart[]>(),
    metadata: text({ mode: "json" }).$type<ChatMessageMetadata>(),
    status: text().notNull().default("complete"), // "streaming" | "complete"
    ord: integer().notNull(),
    timeStarted: integer(),
    timeCompleted: integer(),
    durationMs: integer(),
    inputTokens: integer(),
    outputTokens: integer(),
  },
  (t) => [uniqueIndex("message_session_ord_uq").on(t.sessionId, t.ord)],
);
```

- **Parts as JSON column** keeps v1 aligned with `useChat`/`UIMessage`.
  Incremental streaming persistence = upsert the message row as parts grow, with
  `status` flipping `streaming → complete`.
- **Dropped vs. Prisma:** `userId` (→ `directory`), `credits`, `billed` (no
  billing). `inputTokens`/`outputTokens` retained for a local `/cost`-style view
  (fidelity: `claude-code/src/commands/cost`).
- **Post-v1 option (from opencode):** normalize parts into a separate `part`
  table (row per part) for row-level incremental writes — revisit when `useChat`
  is replaced by a hand-rolled loop.
- **Near-term optional (from opencode):** persist `todo` (session_id, content,
  status, priority, position) and permission rulesets so they survive restarts;
  currently in-memory, so out of v1 core.

## 8. Phased cutover strategy

Ordered so the app is never left half-broken (each phase compiles + runs). Each
phase is its own implementation plan, branch, and PR; the branch name is the
slug shown in `code font`.

- **`local-store`** — Drizzle/`bun:sqlite` store + config/secrets module;
  `~/.knightcode/` bootstrap and migrations. No behavior change yet (store usable
  in parallel).
- **`openrouter-inference`** — `LocalChatTransport` + `resolveModel`; swap the
  `useChat` transport; move compaction and the subagent step local. Inference
  streams from OpenRouter using a key read from config/env. Server still present
  but unused by the main path.
- **`strip-server`** — repoint dialog reads to the local store; delete
  `packages/server`, OAuth, `api-client.ts`, billing/credit UI; remove
  Clerk/Polar/Sentry/Prisma deps.
- **`web-tools`** — WebFetch local; WebSearch BYO-key with graceful degrade.
- **`onboarding`** — first-run onboarding wizard + later-change path.
- **`ui-revamp`** — restructure components to mirror claude-code's surfaces on
  OpenTUI; its own multi-step plan (input box, message stream, tool/diff
  rendering, status bar, dialogs, theming).
- **`npm-release`** — bin/build/`README`/version; publish dry-run.

## 9. Risks & mitigations

- **Tool-calling variance across OpenRouter models** → curated shortlist;
  document that quality tracks the model (§1).
- **Custom-transport protocol drift** — the transport must emit a valid AI SDK
  UI-message stream → build against `toUIMessageStream()` and test the loop's
  tool-call completion path.
- **Prisma removal ripples** into several dialogs → `local-store` lands the
  store first so `strip-server` is a mechanical repoint.
- **Migrations in a published binary** — generated SQL must ship with the package
  and apply on first run → bundle the `drizzle-kit` migration files and run them
  at startup (opencode's pattern as reference).
- **Bun runtime requirement** for end users (OpenTUI + `bun:sqlite`) → accepted
  constraint; documented install path (`bunx` / Bun + global install).
- **Secret handling** → `0600` config, never logged or persisted to sessions.

## 10. Decisions locked in this spec

1. Pure-local BYOK; server/accounts/billing removed.
2. **Drizzle ORM over `bun:sqlite`** under `~/.knightcode/` (migrations via
   `drizzle-kit`); Prisma removed. Sessions scoped by working directory. Schema
   per §7. Adopted after comparing opencode, which runs the same stack.
3. Direct OpenRouter streaming via a custom `ChatTransport`; `useChat` retained
   for v1 (hand-rolled loop deferred).
4. Curated model shortlist in `shared` + free-form override; provider-agnostic
   default finalized at implementation.
5. WebFetch local; WebSearch optional BYO key, graceful degrade.
6. Config in `config.json` + env overrides; onboarding wizard replaces OAuth.
7. v1 = cutover + **full UI revamp**; full claude-code parity deferred.
8. **UI framework: stay on OpenTUI** (claude-code uses a bespoke
   react-reconciler renderer, not Ink; OpenTUI is the same family). Ink rejected
   — full rewrite, different paradigm, no fidelity gain.
