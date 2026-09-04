# @knightcodeai/cli

## 0.5.4

### Added

- Added an entries argument to `SessionManager.inMemory()`, so an SDK embedder can resume a session held outside the filesystem — in a database, say — without writing it to a temporary `.jsonl` file first.

- Added the relational algebra join operators to LaTeX rendering: `\bowtie`, `\Join`, `\ltimes`, `\rtimes`, `\leftouterjoin`, `\rightouterjoin` and `\fullouterjoin`.

- Added a `vllmPriority` compat flag for custom `openai-completions` providers. Set it on a model and requests carry a top-level `priority` field, which a vLLM server running with `--scheduling-policy priority` uses to order work; lower values are served first. Unset by default, so nothing changes for providers that do not want it.

### Changed

- Changed the branch summary output cap from 2048 to 4096 tokens, clamped to the model's own limit, so summaries of long branches are no longer cut off mid-sentence.

- Changed the Cloudflare AI Gateway binding transport to pass requests straight to the Workers AI binding's `fetch` rather than translating them into universal-endpoint calls. `createGatewayBindingFetch` is replaced by `createAiBindingFetch(env.AI)`, which supports every method, non-JSON bodies and streaming request bodies instead of rejecting them.

- Changed the bundled model catalog to a fresh regeneration from models.dev. GitHub Copilot drops eight models that the provider no longer serves (`claude-opus-4.5`, `claude-opus-4.6`, `claude-sonnet-4`, `claude-sonnet-4.5`, `gemini-3.1-pro-preview`, `gpt-4.1`, `gpt-5.2`, `gpt-5.2-codex`) and gains `claude-fable-5.1` and `gemini-3.8-flash`. This regeneration is also what activates the Copilot Fable 5 routing fix, which changed only the generator and so never reached the committed data. Baseten gains `zai-org/GLM-5.3-Fast`, Cloudflare AI Gateway gains `claude-fable-5.1`, and OpenCode Go gains `omen-alpha`.

  Removals only take effect through regenerated data: the remote catalog overlay merges by id and can add or update models, but never removes them, so a model that disappears upstream keeps appearing until the bundled catalog is refreshed.

- Changed the selectors in `/thinking`, `/model`, `/scoped-models`, `/trust` and per-model thinking settings to keep the active option marked while browsing, by moving the marker into a fixed column ahead of the label. `/scoped-models` now uses the same per-item toggle as the rest, strikes through models that are no longer available, and no longer collapses to a single model when the first one is toggled off.

- Changed the theme settings selectors to keep the configured theme marked while browsing, matching the other selectors. Both the fixed-theme list and the light/dark lists behind Automatic now show the marker in a fixed column.

- Changed the streaming working indicator to render in the editor's top border instead of on its own row above it, so the editor no longer shifts up and down as a turn starts and finishes. It picks up the editor's border colour, which already tracks the thinking level. Custom editors from extensions keep the standalone row unless they opt in with `embedWorkingStatus`.

### Fixed

- Fixed aborting a session leaving an in-progress compaction or branch summary running. Escape during `/compact`, or an RPC `abort`, now cancels it and waits for the session to actually be idle before returning.

- Fixed Baseten's GLM-5.2 and GLM-5.2-Fast being advertised as accepting images. The catalog reports image input for them but the endpoints are text-only, so attaching an image produced a provider error instead of being caught up front.

- Fixed a Codex response being dropped when the server closed the stream without a blank line after the final event. The last frame is now processed at EOF instead of being discarded with the buffer.

- Fixed GitHub Copilot Claude Fable models being served through the OpenAI completions adapter, which dropped the selected reasoning level. They now route through the Anthropic Messages adapter like the other Claude 4.x and 5.x models on that provider.

- Fixed Fireworks GLM models other than GLM-5.2 being served through the Anthropic-compatible endpoint, which does not accept them. Every `glm-` model on Fireworks now uses the OpenAI completions endpoint, so GLM-5.3 and GLM-5.3 Flash work.

- Fixed forking a compacted session losing the messages after the compaction boundary when that boundary pointed at a label. Labels are dropped from the forked path, which left the boundary pointing at an entry that no longer existed.

- Fixed importing a session file silently overwriting a stored session that happened to have the same filename. The import is now written alongside it under a numbered name.

- Fixed a proxied request hanging when the server closed the stream without sending a terminal event, and a final event that arrived without a trailing newline being dropped. The first now surfaces as an error, the second is processed.

- Fixed proxied plain-HTTP provider requests hanging after a tool call by tunneling them with CONNECT again, restoring the behaviour Undici changed in 8.7.

- Fixed Qwen3.8 Flash offering the wrong thinking levels on the Qwen Token Plan providers: it advertised high and max, which it does not accept, instead of low, medium and xhigh. It is also now listed on the Individual plan, where it is available.

- Fixed the built-in tools ignoring the working directory supplied on the extension context. `read`, `write`, `edit`, `ls`, `find`, `grep` and the shell tool resolved relative paths against the directory captured when the tool was created, so a caller running a tool against a different directory operated in the session's directory instead of its own.

- Fixed `fd` and `ripgrep` failing to download behind shared egress IPs, where the anonymous GitHub API rate limit is permanently exhausted. The latest release is now resolved from the release page redirect, which costs no API quota. A failed download also reports the underlying network error instead of a bare "fetch failed".

- Fixed `knightcode update` reporting every install as a standalone binary. `bin/knightcode` spawns the compiled binary out of `node_modules`, so install detection now classifies a binary by where it sits rather than by how it was built, and moves the running executable aside on Windows so npm can replace it.

- Fixed the write tool reporting UTF-16 code-unit counts as byte counts by removing the misleading count from its result.

## 0.5.3

### Patch Changes

- 6ffe494: Run the auto-compaction threshold check between turns of an agent run, so a
  tool batch that fills the context window is compacted before the next
  assistant request instead of overflowing it.
- 6cfef9a: Add a `fullscreenCopyOnSelect` setting (default `true`). Turn it off and a
  fullscreen mouse selection stays highlighted instead of being copied on mouse
  release, and `Ctrl+X` copies the active selection rather than the last
  assistant message.
- eb15117: Settle the running turn before an in-memory `/fork`, so the aborted assistant
  message and its tool results are no longer appended to the freshly forked
  session.
- 9a492f9: Merge Mistral streaming tool-call chunks by their `index`, so a call whose id
  and name arrive only in the first chunk is no longer split into two tool
  calls with truncated arguments. A name that arrives on a later chunk is
  picked up rather than left empty.
- 766dbca: Match `NO_PROXY` entries against the root domain and its subdomains, and parse
  IPv6 hosts and `host:port` entries correctly, so a bare `example.com` entry
  also bypasses the proxy for `api.example.com` and `notexample.com` no longer
  matches it. A bare `*` entry now bypasses everything even when listed
  alongside other entries, and an entry with a malformed port is dropped rather
  than widened into a host-wide bypass.
- 3ad5109: Add a `supportsMaxOutputTokens` compat flag for `openai-responses` models
  (default `true`). Set it to `false` for a gateway that rejects
  `max_output_tokens` and the parameter is omitted instead of failing the
  request.
- 94e9d3b: Stop already-prepared tool calls from running when a parallel batch is aborted
  during preflight, so cancelling at a permission prompt no longer lets the
  remaining tools in that batch execute.
- 00c4a60: Ignore a failing SIGWINCH self-signal at terminal startup, so sandboxes whose
  seccomp or LSM policy denies `kill(2)` no longer crash on launch. The
  dimension refresh is skipped instead.
- c058c12: Tidy the tool call transcript block. The dark theme's `green` and `red` now hold
  the pinned diff hexes, so the success bullet, `✓` marks, bash mode and markdown
  code blocks match the diff colours instead of staying olive. Shell tool call
  headers are clamped to a single line — a long command no longer wraps several
  rows of quoted URL over the transcript — and the bash expand hint follows its
  output rather than preceding it, matching every other tool renderer. Line
  counts in the expand hints are pluralised.
- 743bca2: Detect Zed's integrated terminal so it gets truecolor and hyperlinks instead
  of falling through to the conservative default, and document the Zed key
  bindings needed for `Shift+Enter` and friends.

## 0.5.2

### Patch Changes

- 736f894: Read EXIF orientation from JPEGs whose first APP1 segment holds XMP instead of
  EXIF. Such images previously rendered unrotated.
- ec0f150: Clear a delivered steering or follow-up message that carried only images. The
  entry previously stayed in the queue forever, leaving the pending count wrong
  and the message re-queued.
- 13586e1: Give each `/share` its own temp directory so two shares running at once no
  longer overwrite each other's export or delete the other's file mid-upload.
- a90f2eb: Keep skills in the system prompt when `read` is disabled but a shell tool is
  available, and tell the model to load `SKILL.md` with `bash` (or PowerShell)
  instead. Skills previously vanished entirely from bash-only tool setups.
- d28f07d: Ignore Kitty image conversions that land after the tool image at that position
  changed, so a streamed partial image no longer replaces the final result.
- e0fb2d8: Add AgentRouter as a built-in provider. `AGENTROUTER_API_KEY` enables five
  AgentRouter models, defaulting to `agentrouter/glm-5.3`, with Claude routed through
  the Anthropic Messages endpoint and the rest through the OpenAI-compatible one.
  Token prices come from AgentRouter's rate table rather than upstream list prices;
  cache costs remain estimates because AgentRouter does not publish its cache ratios.

## 0.5.1

### Patch Changes

- 2990a0f: Tool calls now render as blocks in the transcript. Each one shows a
  `Bash(...)` / `Read(...)` / `Update(...)` header with its result collapsed
  underneath on a `⎿` gutter, instead of the flat before/after dump. The rest of
  the chrome — boxed messages, the rounded input frame, the braille spinner, the
  banner and footer — is unchanged.

  Fixed a context-window overflow loop. Messages with no provider usage yet are
  estimated at 4 chars/token, but real tokenizers land nearer 3 on code and JSON,
  so reserving `max_tokens` against the raw estimate could push prompt +
  `max_tokens` past the window. The provider rejected it as an overflow, the agent
  compacted, `max_tokens` re-expanded into the freed room, and the next request
  failed the same way. The estimated part is now padded so the reservation stays
  inside the window.

## 0.5.0

### Minor Changes

- dafe408: A rebuilt agent core.

  The agent loop, session storage, provider layer and terminal UI were all
  replaced. What that buys:

  - **A measured ~1,100-token floor** for the system prompt and tool definitions —
    every request is smaller, on every model.
  - **Real multi-provider support**: Anthropic, OpenAI/Codex, OpenRouter, Amazon
    Bedrock, xAI, Kimi, GitHub Copilot, and any custom endpoint through
    `models.json`. OAuth sign-in where the provider supports it, API keys
    everywhere else.
  - **Sessions you can leave and come back to**: resume, fork, branch, search, and
    automatic compaction when a conversation outgrows the context window.
  - **Extensions, skills and prompt templates**, discovered from the project or
    installed globally.
  - **Headless mode**: `--print` with `text`, `json` or `rpc` output, for scripting
    and for driving KnightCode from another program.

  Distribution is unchanged — a self-contained compiled binary per platform, no
  Bun or Node needed at runtime.

## 0.4.1

### Patch Changes

- 5ffa10b: Re-inject the current todo list after each tool round so the model's plan stays in context during long turns. Only fires when the list has unfinished items and has changed since the last round.

## 0.4.0

### Minor Changes

- aa2645e: Harness reliability: safer edits and recovery from flaky model streams.

  - **No blind or stale edits.** A file must be read before it can be edited, and an edit is rejected if the file changed on disk since that read — so a write can't silently clobber newer changes. The read state is rebuilt from the transcript, so it survives a session resume.
  - **No accidental repeats.** Identical read-only tool calls in one round run once instead of duplicating, and the loop guard stops repeated identical calls sooner.
  - **Auto-retry on flaky streams.** Transient stream failures and empty responses retry with exponential backoff (honoring `Retry-After`); cancelling mid-backoff no longer fires an extra model call.
  - **Tool errors self-correct.** An invalid tool call no longer ends the turn — the model gets the error back and can fix it.
  - **No misleading diffs.** An edit diff shows only after the edit actually applies; failed or rejected edits don't render one.

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
