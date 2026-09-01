# Headless Print Mode (-p) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `knightcode -p "<prompt>"` runs one agentic turn without the TUI and prints the result as text, JSON, or NDJSON (stream-json), with correct exit codes — unblocking terminal-bench and all scripting/CI use.

**Architecture:** A headless pipeline beside the REPL, not inside it: `main.tsx` routes `-p` to a new `cli/print.ts` orchestrator (I/O, formats, exit codes) which drives a new `cli/headlessQuery.ts` generator (builds a React-free ToolUseContext, runs the existing `query()` loop once, wraps yields into upstream-shaped `SDKMessage` envelopes and a final `result` envelope). Permission behavior comes from the existing `hasPermissionsToUseTool` engine plus CLI-rule mapping — no UI prompting; anything that would prompt is denied.

**Tech Stack:** TypeScript, bun (runtime + test), commander (already used), existing fork subsystems (`query()`, `getTools`, `getCommands`, `getSystemPrompt`, `createStore`, `buildSystemInitMessage`, `recordTranscript`, cost-tracker).

**Upstream reference (vendored, read-only):** `shenanigans/claude-code-source/src/` — `cli/print.ts` (runHeadless L455-976, getCanUseToolFn L4267), `QueryEngine.ts` (submitMessage loop L560-1060, ask() L1186), `utils/streamJsonStdoutGuard.ts`.

## Global Constraints

- Brand policy: `packages/cli/src/brand-leak.test.ts` must stay green — no `claude|anthropic|tengu|clawd` tokens outside its ALLOW list; paths are `.knightcode/`, telemetry is `knightcode_*`, env vars are `KNIGHTCODE_*`.
- No new dependencies.
- All commands below run from `packages/cli/` unless stated. Test = `bun test src/<file>`; typecheck = `bun run check-types`.
- Commit after every task; never push; no Co-Authored-By trailer.
- The fork is BYOK/OpenRouter-only: no OAuth, no SDK daemon, no CCR/remote, no GrowthBook (stubbed to defaults).

## Out of Scope (Phase 1) — reject explicitly, do not silently ignore

- `--input-format stream-json`, the SDK control protocol (`control_request`/`control_response`), `--permission-prompt-tool`, `--json-schema`, `--include-partial-messages`, `--replay-user-messages`, `--max-budget-usd`, `--fallback-model`, hook-event streaming.
- `-c/--continue` and `-r/--resume` **combined with** `-p`: print a clear stderr error (`Error: --continue/--resume are not yet supported with --print`) and exit 1. They keep working for the interactive REPL.

---

### Task 1: CLI flags for headless mode

**Files:**
- Modify: `packages/cli/src/cli/parseArgs.ts`
- Test: `packages/cli/src/cli/parseArgs.test.ts` (append)

**Interfaces:**
- Produces (added to `CliOptions`):
  - `outputFormat?: 'text' | 'json' | 'stream-json'`
  - `maxTurns?: number`
  - `allowedTools: string[]`
  - `disallowedTools: string[]`

- [ ] **Step 1: Write the failing tests** (append to `parseArgs.test.ts`, matching its existing style):

```ts
describe('headless flags', () => {
  test('--output-format parses and validates choices', () => {
    expect(parseCliArgs(['-p', 'hi', '--output-format', 'json']).outputFormat).toBe('json')
    expect(parseCliArgs(['-p', 'hi']).outputFormat).toBeUndefined()
    expect(() => parseCliArgs(['-p', 'hi', '--output-format', 'yaml'])).toThrow()
  })
  test('--max-turns parses as a number', () => {
    expect(parseCliArgs(['-p', 'hi', '--max-turns', '3']).maxTurns).toBe(3)
    expect(parseCliArgs(['-p', 'hi']).maxTurns).toBeUndefined()
  })
  test('--allowedTools / --disallowedTools accept space- and comma-separated values', () => {
    const o = parseCliArgs(['-p', 'hi', '--allowedTools', 'Bash(git:*)', 'Edit', '--disallowedTools', 'WebSearch,WebFetch'])
    expect(o.allowedTools).toEqual(['Bash(git:*)', 'Edit'])
    expect(o.disallowedTools).toEqual(['WebSearch', 'WebFetch'])
  })
  test('defaults are empty arrays', () => {
    const o = parseCliArgs(['-p', 'hi'])
    expect(o.allowedTools).toEqual([])
    expect(o.disallowedTools).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/cli/parseArgs.test.ts`
Expected: FAIL (unknown option / undefined fields).

- [ ] **Step 3: Implement.** In `buildProgram`, change the `-p` help text to `'Print response and exit (headless). Reads the prompt from the argument or stdin.'` and add after the existing options:

```ts
.addOption(
  new Option(
    '--output-format <format>',
    'Output format (only with --print): "text" (default), "json", or "stream-json"',
  ).choices(['text', 'json', 'stream-json']),
)
.addOption(
  new Option(
    '--max-turns <turns>',
    'Maximum agentic turns in headless mode; exits early when reached (only with --print)',
  ).argParser(Number),
)
.option(
  '--allowedTools, --allowed-tools <tools...>',
  'Comma or space-separated tool rules to allow (e.g. "Bash(git:*) Edit")',
)
.option(
  '--disallowedTools, --disallowed-tools <tools...>',
  'Comma or space-separated tool rules to deny',
)
```

In `parseCliArgs`, add a local helper and the new fields:

```ts
const splitToolRules = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(s => String(s).split(',')).map(s => s.trim()).filter(Boolean) : []

return {
  // ...existing fields...
  outputFormat: opts.outputFormat as 'text' | 'json' | 'stream-json' | undefined,
  maxTurns: typeof opts.maxTurns === 'number' && !Number.isNaN(opts.maxTurns) ? opts.maxTurns : undefined,
  allowedTools: splitToolRules(opts.allowedTools),
  disallowedTools: splitToolRules(opts.disallowedTools),
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test src/cli/parseArgs.test.ts && bun run check-types` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(cli): parse headless flags (--output-format, --max-turns, tool allow/deny)"`

---

### Task 2: Port streamJsonStdoutGuard

**Files:**
- Create: `packages/cli/src/utils/streamJsonStdoutGuard.ts` (port of `shenanigans/claude-code-source/src/utils/streamJsonStdoutGuard.ts`, 123 lines)
- Test: `packages/cli/src/utils/streamJsonStdoutGuard.test.ts`

**Interfaces:**
- Produces: `installStreamJsonStdoutGuard(): void`, `writeToStdout(s: string): void` (guard-bypassing writer; check the upstream file for the exact export set and keep it).

Port rules: copy the vendored file, then (a) rename any `tengu_*`/`CLAUDE_*` tokens per Global Constraints, (b) drop imports that don't exist in the fork (check each; the file is self-contained except logging — use `logForDebugging` from `src/utils/debug.js` if upstream logs), (c) keep the mechanism byte-equivalent: patch `process.stdout.write` so only JSON-looking lines (starting with `{`) pass; divert everything else to stderr.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, expect, test } from 'bun:test'
import { installStreamJsonStdoutGuard, writeToStdout } from './streamJsonStdoutGuard.js'

test('guard diverts non-JSON stdout lines to stderr, passes JSON and writeToStdout', () => {
  const out: string[] = []
  const err: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  // Capture before installing so the guard wraps our capture.
  process.stdout.write = ((s: string) => (out.push(String(s)), true)) as never
  process.stderr.write = ((s: string) => (err.push(String(s)), true)) as never
  try {
    installStreamJsonStdoutGuard()
    process.stdout.write('stray library banner\n')
    writeToStdout('{"type":"result"}\n')
    expect(out.join('')).toBe('{"type":"result"}\n')
    expect(err.join('')).toContain('stray library banner')
  } finally {
    process.stdout.write = origOut as never
    process.stderr.write = origErr as never
  }
})
```

(Adjust assertions to the ported implementation's exact semantics after reading it — e.g. if the guard itself passes `{`-prefixed lines on stdout.write, assert that too.)

- [ ] **Step 2: Run to verify failure** — `bun test src/utils/streamJsonStdoutGuard.test.ts` → FAIL (module not found).
- [ ] **Step 3: Port the file** per the port rules above.
- [ ] **Step 4: Run test + typecheck + brand test** — `bun test src/utils/streamJsonStdoutGuard.test.ts src/brand-leak.test.ts && bun run check-types` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): port stream-json stdout guard"`

---

### Task 3: SDK message envelopes + result builder

**Files:**
- Create: `packages/cli/src/utils/messages/sdkEnvelopes.ts`
- Test: `packages/cli/src/utils/messages/sdkEnvelopes.test.ts`

**Interfaces:**
- Consumes: `SDKMessage` (`src/entrypoints/agentSdkTypes.js`), `getSessionId` (`src/bootstrap/state.js`), `getTotalCost`/`getTotalAPIDuration` (`src/cost-tracker.js`), `Message` type (`src/utils/messages.js`).
- Produces:
  - `toSdkEnvelope(msg: Message): SDKMessage | null` — wraps `assistant`/`user` messages; returns `null` for every other type.
  - `type ResultSubtype = 'success' | 'error_during_execution' | 'error_max_turns'`
  - `buildResultMessage(args: { subtype: ResultSubtype; startTime: number; numTurns: number; resultText: string; usage: Usage; stopReason: string | null; errors?: string[] }): SDKMessage`
  - `EMPTY_SDK_USAGE`, `accumulateSdkUsage(a, b)` — reuse the fork's existing usage helpers if `grep -rn "accumulateUsage\|updateUsage" src/utils src/services` finds them (the context-accounting port likely brought them); otherwise implement field-wise addition over `{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`.

Wire shapes must mirror upstream (`QueryEngine.ts` L560-640, L2429 in print.ts):

```ts
// assistant / user envelope
{ type: msg.type, message: msg.message, session_id: getSessionId(),
  parent_tool_use_id: null, uuid: msg.uuid, timestamp: msg.timestamp }

// result envelope
{ type: 'result', subtype, is_error: subtype !== 'success',
  duration_ms: Date.now() - startTime, duration_api_ms: getTotalAPIDuration(),
  num_turns, result: resultText, stop_reason: stopReason,
  session_id: getSessionId(), total_cost_usd: getTotalCost(),
  usage, modelUsage: {}, permission_denials: [], uuid: randomUUID(),
  ...(errors ? { errors } : {}) }
```

(`modelUsage`/`permission_denials` are emitted empty in Phase 1 — the fields exist so parsers written against upstream don't break. Note this in a comment.)

- [ ] **Step 1: Write failing tests** — cover: assistant envelope fields, user envelope fields, `null` for `progress`/`attachment`/`system` messages, success result (`is_error: false`, `result` text, `num_turns` passthrough), `error_max_turns` result (`is_error: true`), usage accumulation.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** per the shapes above.
- [ ] **Step 4: Run test + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): SDK message envelopes + result builder for headless output"`

---

### Task 4: CLI permission rules for headless

**Files:**
- Create: `packages/cli/src/cli/headlessPermissions.ts`
- Test: `packages/cli/src/cli/headlessPermissions.test.ts`

**Interfaces:**
- Consumes: `ToolPermissionContext` + rule types (`src/types/permissions.js` / `src/utils/permissions/`), `getEmptyToolPermissionContext` (grep `src/tools.ts:192` usage for its import source), `PermissionMode`.
- Produces:
  - `buildHeadlessPermissionContext(opts: { permissionMode?: PermissionMode; dangerouslySkipPermissions: boolean; allowedTools: string[]; disallowedTools: string[] }): ToolPermissionContext`

Behavior (mirrors upstream print-mode semantics):
1. Start from the empty context; set `mode` = `'bypassPermissions'` when `dangerouslySkipPermissions`, else `permissionMode ?? 'default'`.
2. Add each `allowedTools` entry as an always-allow rule and each `disallowedTools` entry as an always-deny rule, with rule source/destination `'cliArg'` (find the exact field names in the fork's permission-rule type — upstream uses `{ source: 'cliArg' }`; follow whatever `--allowedTools`-equivalent structures already exist in `toolPermissionContext`, e.g. `alwaysAllowRules['cliArg'] = [...]`).
3. Deny wins over allow (this is enforced by the existing engine, not here — do not re-implement).

The actual allow/deny decision at tool-call time is the existing `hasPermissionsToUseTool` (`src/utils/permissions/permissions.js`) passed directly as `canUseTool` — same as upstream `getCanUseToolFn` with no prompt tool. Do NOT write a custom decision function. In headless there is no UI: a result that would prompt resolves as a deny by the query loop's non-interactive path (`isNonInteractiveSession: true` in context options).

- [ ] **Step 1: Write failing tests** — context mode mapping (bypass flag → `bypassPermissions`; explicit `--permission-mode plan` → `plan`; default → `default`), allow rules land under cliArg allow, deny rules land under cliArg deny, empty arrays add nothing.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run test + typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): headless permission context from CLI flags"`

---

### Task 5: Headless turn runner (`runHeadlessTurn`)

**Files:**
- Create: `packages/cli/src/cli/headlessQuery.ts`
- Test: `packages/cli/src/cli/headlessQuery.test.ts`

**Interfaces:**
- Consumes: `query` + `QueryParams` (`src/query.js`), `getTools` (`src/tools.js`), `getCommands` (`src/commands.js`), `getSystemPrompt` (`src/constants/prompts.js`), `createStore` (`src/state/store.js`), `getDefaultAppState` (`src/state/AppStateStore.js`), `buildSystemInitMessage` (`src/utils/messages/systemInit.js`), `recordTranscript` (`src/utils/sessionStorage.js`), `hasPermissionsToUseTool`, Task 3 envelopes, Task 4 context builder, `createUserMessage`-equivalent from `src/utils/messages.js` (grep for the factory the REPL uses to build the first user message).
- Produces:
  - `type HeadlessTurnOptions = { prompt: string; cwd: string; model?: string; permissionMode?: PermissionMode; dangerouslySkipPermissions: boolean; allowedTools: string[]; disallowedTools: string[]; maxTurns?: number; systemPrompt?: string; appendSystemPrompt?: string; verbose: boolean; queryFn?: typeof query }`
  - `runHeadlessTurn(opts: HeadlessTurnOptions): AsyncGenerator<SDKMessage>`

Implementation outline (mirror `QueryEngine.submitMessage`, vendored L560-1060, trimmed):

1. `const startTime = Date.now()`; build permission context (Task 4); `const store = createStore(getDefaultAppState())` with `toolPermissionContext` and `verbose` applied; `tools = getTools(permissionContext)`; `commands = await getCommands(cwd)`.
2. Build a React-free `ProcessUserInputContext` in a private helper `buildHeadlessToolUseContext()` modeled on `screens/REPL.tsx:3187` `getToolUseContext` — same `options` block with `isNonInteractiveSession: true`, `refreshTools` recomputing from the store, and no-op implementations for every UI callback (`setToolJSX`, `addNotification`, `openMessageSelector`, `sendOSNotification`, `onInstallIDEExtension`, message-selector state); `messages`/`setMessages` close over a local array; `readFileState` = fresh cache object (copy the REPL's initializer); `getAppState`/`setAppState` from the store. Keep this helper in `headlessQuery.ts` — it is the file's core responsibility.
3. Resolve model: `opts.model` (already normalized by main.tsx `--model` handling — reuse the same resolution call main.tsx makes) else the session default.
4. System prompt: `opts.systemPrompt` replaces; else `await getSystemPrompt(tools, model, undefined, mcpClients)` joined, plus `opts.appendSystemPrompt` appended.
5. `yield buildSystemInitMessage({ tools, mcpClients: [], model, permissionMode, commands, agents: [], skills: [], plugins: [], fastMode: undefined })` (match `SystemInitInputs` exactly; empty MCP/agents/plugins in Phase 1).
6. Seed `messages = [userMessage(prompt)]`; run `for await (const m of (opts.queryFn ?? query)({ messages, systemPrompt, canUseTool: hasPermissionsToUseTool, toolUseContext, querySource: 'sdk', maxTurns: opts.maxTurns, userContext, systemContext, ... })`)` — copy the exact `QueryParams` the REPL passes at `screens/REPL.tsx:3376` and adapt.
7. Per message, mirror the upstream switch (vendored `QueryEngine.ts` L700-830): `assistant`/`user` → push to `messages`, `yield toSdkEnvelope(m)`, track `turnCount` (user messages), capture `stop_reason`, capture last assistant text as `resultText`; `stream_event` → accumulate usage on `message_start`/`message_delta`/`message_stop` and capture `stop_reason` from `message_delta`; `attachment` with `attachment.type === 'max_turns_reached'` → `yield buildResultMessage({ subtype: 'error_max_turns', ... })` and return; others ignored.
8. After the loop: `await recordTranscript(messages)` (best-effort try/catch), then `yield buildResultMessage({ subtype: 'success', startTime, numTurns: turnCount, resultText, usage, stopReason })`.
9. Wrap the whole body in try/catch: on error `yield buildResultMessage({ subtype: 'error_during_execution', errors: [errorMessage(err)], ... })` (import `errorMessage` from `src/utils/errors.js`).

- [ ] **Step 1: Write failing tests** using a stubbed `queryFn` (no network):

```ts
async function* fakeQuery() {
  yield { type: 'assistant', uuid: 'a1', timestamp: 't', message: { role: 'assistant', content: [{ type: 'text', text: 'hello world' }] } } as never
  return { type: 'success' } as never
}
test('yields init, assistant envelope, then success result with the assistant text', async () => {
  const out: SDKMessage[] = []
  for await (const m of runHeadlessTurn({ prompt: 'hi', cwd: process.cwd(), dangerouslySkipPermissions: true, allowedTools: [], disallowedTools: [], verbose: false, queryFn: fakeQuery as never })) out.push(m)
  expect(out[0]?.type).toBe('system')            // init
  expect(out[1]?.type).toBe('assistant')
  const result = out.at(-1) as Record<string, unknown>
  expect(result.type).toBe('result')
  expect(result.subtype).toBe('success')
  expect(result.is_error).toBe(false)
  expect(result.result).toBe('hello world')
})
```

Add: max-turns test (fakeQuery yields `attachment` with `max_turns_reached` → result subtype `error_max_turns`, `is_error: true`); throwing fakeQuery → `error_during_execution` result yielded (not thrown).

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** per the outline. Where a field of `ProcessUserInputContext` is unclear, read `screens/REPL.tsx:3187-3320` and copy the shape with no-ops.
- [ ] **Step 4: Run test + typecheck + full suite** — `bun test src/cli/headlessQuery.test.ts && bun run check-types && bun test src` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): headless turn runner over the query loop"`

---

### Task 6: Print orchestrator + main.tsx wiring

**Files:**
- Create: `packages/cli/src/cli/print.ts`
- Modify: `packages/cli/src/main.tsx:98-104` (replace the stub)
- Test: `packages/cli/src/cli/print.test.ts`

**Interfaces:**
- Consumes: Task 5 `runHeadlessTurn`, Task 2 guard + `writeToStdout`, `CliOptions` (Task 1), `hasKnightcodeApiKeyAuth` (`src/utils/auth.js`).
- Produces: `runPrintMode(cli: CliOptions, io?: { stdout: (s: string) => void; stderr: (s: string) => void; readStdin: () => Promise<string>; turnFn?: typeof runHeadlessTurn }): Promise<number>` — returns the exit code; `main.tsx` calls `process.exit(await runPrintMode(cli))`.

Behavior:
1. Validate: `--output-format stream-json` requires `--verbose` (upstream parity) → stderr error, return 1. `-c/--resume` with `-p` → stderr error, return 1.
2. Prompt: positional arg; else if stdin is not a TTY, `await readStdin()` (default impl: accumulate `process.stdin`); if still empty → `Error: Input must be provided either through stdin or as a prompt argument when using --print`, return 1.
3. `stream-json`: `installStreamJsonStdoutGuard()` first, then write each yielded message as one NDJSON line via `writeToStdout(JSON.stringify(m) + '\n')`.
4. `json`: buffer; at end print the final `result` message (or the full array when `--verbose`).
5. `text` (default): print `result.result` (append `\n` if missing); for error subtypes print the upstream-parity strings (`Execution error`, `` `Error: Reached max turns (N)` ``).
6. Exit code: `result.is_error ? 1 : 0`; no result seen → 1.
7. SIGINT: abort via an `AbortController` threaded into `runHeadlessTurn` options (add `abortSignal?: AbortSignal` to `HeadlessTurnOptions` and pass into the toolUseContext's abortController) and return 130.

main.tsx wiring (replace the stub): after the auth check (`hasKnightcodeApiKeyAuth()` — missing key in print mode = stderr `Error: no API key configured. Set OPENROUTER_API_KEY or run knightcode to log in.`, exit 1), before any interactive setup:

```ts
if (cli.print) {
  const { runPrintMode } = await import('./cli/print.js')
  process.exit(await runPrintMode(cli))
}
```

Keep `setIsInteractive(true)` on the interactive path only; print mode must leave `getIsNonInteractiveSession()` true.

- [ ] **Step 1: Write failing tests** with injected `io` + `turnFn` (a stub yielding init/assistant/result): text mode prints result text and returns 0; json mode prints single result JSON; stream-json without verbose returns 1 with stderr message; stream-json+verbose emits one JSON line per message; `is_error` result returns 1; missing prompt returns 1.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `cli/print.ts`, then wire main.tsx.**
- [ ] **Step 4: Run test + typecheck + full suite + brand test** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): headless print mode (-p, --output-format text|json|stream-json)"`

---

### Task 7: Live smoke test + verification

**Files:**
- Create: `packages/cli/src/cli/print.live.test.ts` (opt-in, env-gated like `src/utils/model/profile/contract.live.test.ts`)

- [ ] **Step 1: Write the gated live test** — skipped unless `KNIGHTCODE_RUN_LIVE_HEADLESS=1`: spawn `bun src/main.tsx -p "Reply with exactly: pong" --output-format json` (cwd `packages/cli`, env passthrough), parse stdout as JSON, assert `type === 'result'`, `subtype === 'success'`, exit code 0, and `result` contains `pong`.
- [ ] **Step 2: Manual end-to-end verification** (requires `OPENROUTER_API_KEY` in `../../.env`):

```
bun --env-file=../../.env src/main.tsx -p "Reply with exactly: pong"
bun --env-file=../../.env src/main.tsx -p "Reply with exactly: pong" --output-format json
echo "Reply with exactly: pong" | bun --env-file=../../.env src/main.tsx -p --output-format stream-json --verbose
```

Expected: text → `pong` + exit 0; json → one JSON object ending in `"subtype":"success"`; stream-json → NDJSON lines (system/init, assistant, result). Record actual outputs in the task report.
- [ ] **Step 3: Run the full suite one more time** — `bun test src && bun run check-types` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "test(cli): opt-in live smoke for headless print mode"`

---

## Self-Review Notes

- Spec coverage: `-p` arg/stdin prompt ✓ (T6), three output formats ✓ (T6), stream-json guard ✓ (T2), exit codes ✓ (T6), SIGINT ✓ (T6), max-turns ✓ (T1/T5), permission flags ✓ (T1/T4), upstream-shaped envelopes ✓ (T3/T5), out-of-scope combos rejected explicitly ✓ (T6).
- Known simplifications (documented in code comments): `modelUsage`/`permission_denials` emitted empty; MCP servers/agents/skills not surfaced in init message; no `--continue/--resume` in print mode. All are Phase-2 follow-ups and do not change wire field names.
