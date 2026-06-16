---
"@knightcodeai/cli": minor
---

Standalone query engine, concurrent tool scheduler, and Apache-2.0 licensing.

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
