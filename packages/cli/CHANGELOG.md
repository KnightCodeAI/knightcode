# @knightcodeai/cli

## 0.4.0

### Minor Changes

- aa2645e: Harness reliability: read-before-write safety and transient-failure recovery

  - Session-scoped file-state ledger: edits now require the file to have been read first and reject when it changed on disk since that read (read-before-write + staleness guard), seeded from the transcript so it survives a resume.
  - Edit tools collapse identical safe reads within a round and stop looping on repeated identical calls sooner (loop-guard threshold lowered).
  - Streaming recovery: transient stream failures and empty responses are retried with bounded exponential backoff (honoring Retry-After); a cancel during backoff no longer triggers an extra model call.
  - An invalid tool call no longer ends the turn — the model is given the error and a chance to self-correct.
  - A file edit diff is shown only once the edit actually applies; failed or rejected edits no longer render a misleading diff.

## 0.3.1

### Patch Changes

- a2679c6: Fix the `/exit` command freezing the terminal in packaged builds. Process cleanup used `spawnSync(process.execPath, ["-e", ...])` as a sleep, but in a compiled standalone binary `process.execPath` is the CLI itself, so it relaunched the TUI and blocked forever. Replaced it with an in-process sleep and made exit terminate the process explicitly.

## 0.3.0

### Minor Changes

- 9531729: Add automatic skill discovery, hot-reload, and path-scoped skills so installed skills surface and get loaded without having to be named explicitly.

  ### Added
  - **Skill auto-discovery.** Each turn a cheap side-query compares your request against the installed skills, surfaces the relevant ones, and directs the model to load them via the `Skill` tool before responding. Surfaced skills appear as a visible `↳ Relevant skills: …` line in the chat. Controlled by the `skills.autoDiscover` setting (on by default).
  - **Skill hot-reload.** A file watcher picks up added, edited, or removed `SKILL.md` files mid-session, so changes take effect without restarting. Controlled by the `skills.hotReload` setting (on by default).
  - **Path-scoped (conditional) skills.** A skill with a `paths` frontmatter glob is kept out of the always-on skill list and surfaces only when you edit a file matching its globs.

  ### Changed
  - The skill index injected into the system prompt is now size-bounded: descriptions are truncated to fit the budget and, in the extreme, the listing falls back to names only — but every skill name is always shown, so no installed skill becomes undiscoverable.

## 0.2.1

### Patch Changes

- b529674: ### Added

  Memory follow-ups: feed recent tool usage into the recall selector as an extra relevance signal, frame extraction's "new messages" window from a per-session cursor (so durable facts mentioned during gate-skipped turns are still reconsidered), and drain any in-flight memory extraction on `/exit` (bounded) so a save isn't dropped at shutdown.

  ### Fixed

  `Tab` mode cycle so it reaches `AUTO`: previously `Tab` only toggled between `BUILD` and `PLAN`, making `AUTO` selectable solely via the `/agents` dialog. `Tab` now cycles `BUILD → PLAN → AUTO → BUILD`.

  ### Removed

  Drop two unused dependencies from `@knightcodeai/cli`: `pretty-ms` (never imported) and `hono` (the toast provider's `useMemo` now imports from `react` instead of `hono/jsx`).

- 23a8811: Refresh the supported model catalog: add newer free and paid OpenRouter models, repoint aliases to their successors, change the default model, and drop discontinued entries.

  ### Added

  Refresh the supported model catalog with new OpenRouter models: `nvidia/nemotron-3-ultra-550b-a55b:free` (Nemotron 3 Ultra 550B), `nex-agi/nex-n2-pro:free` (Nex N2 Pro), `qwen/qwen3.7-plus` (Qwen3.7 Plus), `z-ai/glm-5.2` (GLM 5.2), and `moonshotai/kimi-k2.7-code` (Kimi K2.7 Code). New `qwen` and `nex` model aliases accompany them.

  ### Changed

  Default model is now `nvidia/nemotron-3-ultra-550b-a55b:free` (was `z-ai/glm-4.5-air:free`). The `glm`, `kimi`, and `nemotron` aliases were repointed to their successor models (`z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `nvidia/nemotron-3-ultra-550b-a55b:free`), and the onboarding shortlist was updated to match the new catalog.

  ### Removed

  Drop discontinued/older version models: `z-ai/glm-4.5-air:free`, `deepseek/deepseek-v4-flash:free`, `z-ai/glm-5.1`, `moonshotai/kimi-k2.6`, and `nvidia/nemotron-3-super-120b-a12b:free`, along with their `glm_air` and `deepseek` aliases.

- b529674: ### Added

  Accurate per-session cost: enable OpenRouter usage accounting (`usage.include`) so each request returns its **actual** cost. The in-app `/cost` "Session cost" now sums real costs (correct for free/cached/uncurated models) and only falls back to the local price table when a message has no reported cost.

  Session grouping on OpenRouter: send the session id as the `x-session-id` header so a session's requests are grouped in OpenRouter's logs (Sessions tab) and routed stickily to the same provider for better prompt-cache hits. Requests are also tagged with the session id via the `user` field for per-request "Client User ID" attribution.

  ### Changed

  OpenRouter app attribution: `HTTP-Referer` → `https://knightcode.raghavseth.in` and `X-Title` → `KnightCode` (was "KnightCode CLI").

## 0.2.0

### Minor Changes

- f2846df: Standalone query engine, concurrent tool scheduler, and Apache-2.0 licensing.

  This release replaces the React `useChat`-based chat harness with a dedicated,
  framework-agnostic query engine, adds a concurrency-aware tool scheduler, and
  hardens the interactive terminal experience. The project is now formally
  licensed under Apache-2.0.

  ### Added
  - **Standalone query engine.** A new engine loop drives a turn end-to-end,
    independent of the React render tree (`lib/engine/`). It owns engine event and
    params types, a transcript-repair pass that resolves dangling/unresolved tool
    calls, and tool-gating decisions backed by a loop guard to prevent runaway
    tool cycles.
  - **`useQueryEngine` hook.** A thin React hook that drives the engine loop and
    replaces the previous `useChat` harness entirely.
  - **Concurrency-aware tool scheduler.** Engine-owned scheduling policy runs tool
    rounds with bounded concurrency. Introduces an engine `ToolHost` contract and a
    hook adapter so the engine can execute tools without depending on the UI layer.
  - **Cross-session project memory.** Durable, non-obvious facts are extracted
    automatically after completed turns into a per-project store
    (`~/.knightcode/projects/<cwd>/memory/`) with a `MEMORY.md` recall index.
    Relevant memories are recalled into the system prompt, a consolidation
    ("dream") pass merges and prunes the store, and a `Memory` tool lets the model
    review, correct, or forget entries.
  - **Per-row tool spinners.** Concurrently running tools each get their own inline
    spinner instead of a single shared indicator.
  - **`@`-mention path expansion.** Paths referenced with `@` in a prompt are
    expanded into the model's context at submit time.
  - **PostToolUse `systemMessage` surfacing.** Messages emitted by `PostToolUse`
    hooks are now surfaced to callers.
  - **Apache-2.0 license.** Added root `LICENSE` and `NOTICE` files and `license`
    fields in the workspace and CLI `package.json`.

  ### Changed
  - Extracted `compactHistory` out of the old `use-chat` module and moved chat
    message types into `lib/engine/messages`.
  - Exposed a hook-free `executeRegisteredTool` for engine use.
  - Unified all interactive prompts onto a single shared permission panel.
  - Dropped the unused `sessionId` from `QueryParams`.
  - Pointed repository URLs at the KnightCodeAI org and scoped the publish
    workflow to publishable paths.

  ### Fixed
  - **Quit behaviour:** `/exit` is now the only way to quit; Ctrl+C never exits.
  - **Permissions:** every confirm-gated tool now shows a permission prompt, and
    every awaited tool decision is guaranteed a resolvable prompt; scoped the
    always-allow sweep correctly.
  - **Markdown rendering:** convert `<br>` to real line breaks in prose, expand
    `<br>` table cells into continuation rows, and stop rendering literal `<br>`
    tags.
  - **Interrupts:** render the interrupted marker after the partial response, with
    a plain interrupted notice (no emoji or completion verb); render interrupted
    aborts and surface queued mid-turn submits.
  - **History integrity:** stop schema-validating history and instead quarantine
    invalid tool calls.
  - **State sync:** synchronize message-ref writes, guard submit re-entry, persist
    the final turn snapshot, queue mid-turn submits, clear finished todos, and only
    clear the compacting state when it was actually set.
  - Hardened file reads, question cancellation, and transcript text handling, plus
    a sweep of code-review findings across the engine and UI.

## 0.1.0

### Minor Changes

- 13af3df: Initial public release: `knightcode` ships as a self-contained compiled binary
  (no Bun required) distributed via platform-specific npm packages, with a headless
  `--version` and `doctor`, embedded database migrations, and a non-blocking update
  check.
