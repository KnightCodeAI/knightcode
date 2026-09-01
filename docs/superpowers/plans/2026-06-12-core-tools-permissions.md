# Core Tools + Permission Loop (reseed Phase C) Implementation Plan

> Uncommitted doc (workflow rule). Branch: `core`, local-only. Execute inline (superpowers:executing-plans).

**Goal:** `knightcode --next` can actually work on a project: Read/Write/Edit/Glob/Grep/Bash tools wired into the core loop, with a y/a/n permission prompt for non-read-only calls.

**Architecture:** Reuse the existing, UI-independent executors in `src/lib/tools/*` and the contracts in `@repo/shared` (names, descriptions, schemas, read-only/concurrency flags — all knightcode-authored). A generic `adaptTool(contract, execute, ctx)` maps them onto the core `Tool` shape; `resultForAssistant` is the executor's JSON result, matching what models already consumed via the legacy app. The permission seam is a `canUseTool` callback threaded `QueryEngine → query() → runToolUse`; the UI implements it with an interactive panel (allow once / always-allow this session / deny), auto-allowing read-only calls.

### Task 1: `core/tools/adapt.ts` + `core/tools/index.ts`
- `adaptTool(contract: KnightcodeTool, execute, ctx: {executionRoot, sessionId})` → core `Tool`.
- `buildCoreTools(ctx)` → adapted Read, Write, Edit, Glob, Grep, Bash.
- TDD: adapted Read returns file content from a temp dir; adapted Bash runs `echo`; schema/flags map through.

### Task 2: permission seam in the loop
- `Tool.ts`: `type PermissionDecision = {behavior:"allow"} | {behavior:"deny"; message?: string}`; `type CanUseTool = (tool, input) => Promise<PermissionDecision>`.
- `query()`/`QueryEngine`: optional `canUseTool`; consulted after schema parse, before `call`; deny → `is_error` tool_result ("User declined this call." + message). No callback → allow (tests/loopback).
- TDD: deny → error tool_result + loop continues; allow → executes; callback receives parsed input.

### Task 3: permission UI
- `PermissionPanel` (tool name, input preview, `y` allow · `a` always for this tool this session · `n`/Esc deny; Ctrl+C still exits).
- `CoreApp`: pending-permission state + promise resolver implements `canUseTool`; read-only and always-allowed tools skip the panel; `PromptInput` gets `isActive` and goes inactive while the panel is up.
- Boot smoke addition: fake non-read-only tool + scripted transport → panel appears, `n` produces a declined error row; `y` path executes.

### Task 4: session wiring + verify + commit
- `session.ts`: real session uses `buildCoreTools` (cwd + generated sessionId); loopback session keeps Echo.
- `bun run check-types` + `bun test` green; no process-speak in diff; single commit on `core` (no push). Manual real-key smoke: ask the model to read/edit a scratch file.
