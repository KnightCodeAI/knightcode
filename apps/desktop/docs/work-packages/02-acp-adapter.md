# WP02 — ACP adapter

Status: implemented and validated against stock Zed (2026-09-11)
Date: 2026-09-11
Revision: 2 — three throwaway probes recorded; SDK composition verified

Implement this plan task by task, in order. Each task carries its own test
cycle; do not start the next until the current one's tests pass and
`bun run check-types` is clean. Steps use checkbox (`- [ ]`) syntax for
tracking.

**Goal:** Ship the ACP adapter: an Agent Client Protocol server over stdio
that is a client of `knightcode-engine`, driven end to end by stock Zed with
no fork present. A prompt in Zed's agent panel runs a KnightCode session on
the engine; the agent's file reads come from Zed's buffers, its edits land in
Zed's buffers under per-hunk review, and tools that change anything ask Zed
for permission first.

**Architecture:** Two halves. The engine gains sessions: an `AgentSession`
per id, built the way the CLI builds its own, whose read, edit and write
tools are replaced by client-backed ones and whose tool calls are gated by a
hidden permission extension. Every session event goes out on the existing
`/events` bus; every question the engine has for the client (permission, a
file read, a file write) goes out as a `session.request` event and is
answered by a POST. The adapter subscribes to the bus, maps engine events to
ACP `session/update` notifications, and maps ACP client methods
(`fs/read_text_file`, `fs/write_text_file`, `session/request_permission`)
onto those requests. The adapter holds no model, no credential and no
transcript. Without `--connect` it boots an engine in-process, exactly as
OpenCode's `acp` command boots its own server and talks to it.

**Tech Stack:** TypeScript, Bun, `node:http`, `@agentclientprotocol/sdk`
1.4.0 (protocol version 1 — Zed 1.21.0's `agent-client-protocol` crate 2.0.0
speaks schema v1), Vitest, the faux provider in `packages/ai/src/providers/faux.ts`.

**Spec:** `apps/desktop/docs/architecture.md` — §2 Decisions (the editor
owns the filesystem; the ACP process is a client of the engine), §4.1 Seam 1,
§5 Engine HTTP surface, §10 Phase B, §11 Required tests, §12 Exclusions.

## Global Constraints

Copied verbatim from `AGENTS.md` and the spec. Every task's requirements
implicitly include this section.

- Formatting is Prettier: tabs, 120 columns, LF. Run `bun run format`.
- No `any` unless absolutely necessary. `ToolDef` from
  `packages/cli/src/core/tools/index.ts` is the one sanctioned alias.
- **No inline imports** (`await import()`, `import("pkg").Type`). Top-level
  imports only. This is why the `acp` subcommand is a static import into
  `engine-entry.ts`, not a lazy one.
- `erasableSyntaxOnly` is set: no parameter properties, `enum`, `namespace`,
  `import =`, `export =`. Use explicit fields with constructor assignments.
- Code must work on Windows as well as POSIX. Every path that crosses the
  ACP boundary is absolute; use `node:path` for joins and `fileURLToPath`
  for `file:` URIs.
- After code changes: `bun run check-types` from the repo root, full output,
  on its own line — never chained with `&&`. Fix every error before
  committing.
- Tests run from `packages/cli` with `bun x vitest --run test/engine/<file>`.
- No real provider APIs, keys, or paid tokens. Use the faux provider. The
  root `.env` is auto-loaded by Bun and carries real keys, so **every test
  that creates a session pins the faux model** through `defaultModel` on the
  registry (Task 4). A session left to resolve its own default can pick a
  real provider and bill it on the first prompt.
- The engine's system prompt and tool definitions stay the CLI's, unchanged.
  Replacing a built-in tool's *operations* is allowed; replacing its
  description, prompt snippet or guidelines is not.
- No response body on any route may contain a token, API key, or refresh
  token.
- stdout of the adapter process is the JSON-RPC channel. Nothing else may
  write to it.
- Do not run `bun run build:cli`, `bun run build:engine`, or the full test
  suite unless asked.
- Do not commit unless the user asks. Steps that say "Commit" prepare the
  commit; ask before running it. Never add attribution trailers.

---

## 0. Mandatory reading

Read completely before starting Task 1. Line numbers are as of commit
`8caab979f` (the merge of PR #171).

In this repository:

1. `apps/desktop/docs/architecture.md` — §2, §4.1, §5, §10 Phase B, §11,
   §12, §14.
2. `apps/desktop/docs/work-packages/01-engine-server.md` — Tasks 1, 2, 5,
   7 and 11, Required tests, Validation. The style this plan follows and the
   routes it extends.
3. `packages/cli/src/engine/server.ts` lines 96–104 — the router matches an
   exact path or a `prefix` entry on `${path}/`; first match wins.
4. `packages/cli/src/engine/events.ts` — the bus, the SSE framing
   (`event:` then `data:`), the heartbeat comment.
5. `packages/cli/src/engine/accounts.ts` lines 143–262 —
   `createLoginRegistry`: a provider prompt parked in a map and resolved by a
   later POST. The client-request registry in Task 1 is the same shape.
6. `packages/cli/src/engine/completions.ts` lines 44–95 — `resolveModel`
   and `sendLookupError`; Task 5 exports both.
7. `packages/cli/src/engine/models.ts` — `EngineModel.ref`, the string a
   client sends back to select a model.
8. `packages/cli/src/engine-entry.ts` — the port line on stdout (line 54),
   which the adapter must never emit, and the shutdown handler.
9. `packages/cli/test/engine/completions.test.ts` lines 1–40 and
   `packages/cli/test/engine/models.test.ts` lines 39–58 — how a test wires
   the faux provider into an engine context, and why assertions are scoped
   to the provider the test registered.
10. `packages/cli/src/core/agent-session-services.ts` — whole file.
    `createAgentSessionServices` takes the engine's `ModelRuntime` (line 41)
    and `resourceLoaderOptions` (line 44); `createAgentSessionFromServices`
    takes `customTools` (line 64).
11. `packages/cli/src/core/sdk.ts` lines 173–403 — `createAgentSession`:
    model resolution when none is passed (196–233), the default active tools
    (258–263), `customTools` handed to `AgentSession` (388).
12. `packages/cli/src/core/agent-session.ts` — lines 144–186
    (`AgentSessionEvent`), 513–567 (`_installAgentToolHooks`: the `tool_call`
    extension event is the only hook that runs before a tool executes and
    can block it), 1203–1355 (`prompt`: extension commands, preflight, the
    `preflightResult` callback, the model and auth checks at 1266–1282),
    1663–1676 (`abort`, `waitForIdle`), 2731–2765 (`_refreshToolRegistry`:
    custom tools are inserted after built-ins, so a custom tool with a
    built-in's name replaces its definition and its prompt contribution
    comes from the replacement), 2824–2875 (`_buildRuntime`: the built-in
    read tool gets `autoResizeImages` from settings at line 2829–2840),
    3413–3515 (`getSessionStats`, `getContextUsage`).
13. `packages/cli/src/core/agent-session-runtime.ts` lines 167–178 and
    421–428 — teardown order: abort, `session_shutdown`, dispose.
14. `packages/agent/src/agent-loop.ts` lines 440–470 and 497–535 —
    `tool_execution_start` is emitted before `prepareToolCall`; lines
    607–675 — `prepareToolCall` awaits `beforeToolCall` outright and only
    checks `signal.aborted` afterwards. A permission handler that does not
    release itself on abort parks the turn forever.
15. `packages/agent/src/types.ts` lines 56–70 (`BeforeToolCallResult`),
    362–371 (`AgentToolResult`), 431–449 (`AgentEvent`).
16. `packages/cli/src/core/extensions/types.ts` lines 317–336
    (`ExtensionContext.cwd`, `.signal`), 884–952 (`ToolCallEvent`: `input`
    is the validated arguments), 1123–1132 (`ToolCallEventResult`), 1245
    (`ExtensionHandler`), 1586–1596 (`InlineExtension`);
    `packages/cli/src/core/extensions/runner.ts` lines 978–999
    (`emitToolCall`: the first handler that blocks wins), 190–199
    (`emitSessionShutdownEvent`);
    `packages/cli/src/core/resource-loader.ts` lines 159–194
    (`DefaultResourceLoaderOptions.extensionFactories`).
17. `packages/cli/src/core/tools/read.ts` lines 37–57 and 100–113
    (`ReadOperations`; image detection runs before the read);
    `edit.ts` lines 83–97 and 165–217 (`EditOperations`; read, apply, write
    inside `withFileMutationQueue`; `prepareArguments` normalises the
    `edits` shape before the `tool_call` event sees it);
    `write.ts` lines 27–42 and 65–89 (`WriteOperations`);
    `bash.ts` lines 55–75 and 302–357 (`BashOperations`; the throttled
    snapshot updates; "Command exited with code N" in the error text);
    `tools/index.ts` lines 86–105 (`ToolDef`, `ToolName`);
    `edit-diff.ts` lines 300–312 (`applyEditsToNormalizedContent`).
18. `packages/ai/src/providers/faux.ts` lines 40–60 (`fauxToolCall`),
    120–133 (`tokensPerSecond`, for a turn slow enough to cancel), 360–434
    (the event order per content block), 660–696 (`fauxProvider`).
19. `packages/cli/src/modes/rpc/rpc-mode.ts` lines 391–412 — a prompt
    command that answers as soon as preflight succeeds and lets the turn run;
    the engine's prompt route does the same.

In the Zed source tree (v1.21.0), read-only, paths relative to its root:

20. `crates/agent_servers/src/acp.rs` lines 640–796 — `connect`, the full
    agent→client handler set, `client_capabilities_for_agent` (fs read and
    write, terminal); 806–870 — the agent command is spawned through the
    system shell with cwd set to the first worktree root; 1013–1032 — the
    `initialize` request is protocol version 1; 1637–1746 — `new_session`
    sends `cwd` and the project's MCP servers; 1917–1983 — `prompt` and
    `cancel`: cancel is a notification, the prompt request must still return,
    and an abort error after cancel is turned into `Cancelled`; 4513–4565 —
    `handle_request_permission`; 4683–4745 — `handle_write_text_file` and
    `handle_read_text_file`; 4747–4880 — session notifications, including the
    client-side `_meta.terminal_info`, `terminal_output` and `terminal_exit`
    keys that create a display-only terminal for a tool call.
21. `crates/acp_thread/src/acp_thread.rs` lines 68–76 (`TOOL_NAME_META_KEY`
    is `"tool_name"`), 1266–1318 (`ToolCallStatus`; a grant on a pending call
    makes it in-progress), 1810–1851 (`ToolCallContent::from_acp`: a `diff`
    becomes a finalized diff card; a `terminal` must already be registered),
    2593–2700 (`handle_session_update`: which updates the panel acts on),
    3433–3527 (authorization: a permission request upserts the tool call and
    parks a oneshot), 3700–3763 (`send_inner`: the user message is pushed
    optimistically, so echoing it back is at best deduplicated), 3967–4060
    (`cancel`: pending permission requests are answered `Cancelled` by the
    client itself), 4310–4517 (`read_text_file` reads the buffer, unsaved
    edits included, and records the read in the `ActionLog`;
    `write_text_file` diffs the buffer against the new text, applies the
    edits as an agent transaction, records them in the `ActionLog`, formats
    on save if configured, and saves — this is the review surface).
22. `crates/settings_content/src/agent.rs` lines 739–760 — the JSON shape of
    a custom `agent_servers` entry (`"type": "custom"`, `command`, `args`,
    `env`); `crates/project/src/agent_server_store.rs` lines 34–41
    (`AgentServerCommand`).

Prior art (read-only): OpenCode's ACP adapter, the same job for a different
engine. Learn the mapping; do not copy the code.

23. `packages/opencode/src/cli/cmd/acp.ts` — boots its own server, bridges
    stdio by hand (lines 33–51), and is otherwise a client.
24. `packages/opencode/src/acp/event.ts` lines 69–87 (`runUntilIdle`: a
    prompt is done when the event stream says so, not when the HTTP call
    returns), 171–180 (`disconnected`: an event-stream drop fails every
    pending turn); `src/acp/permission.ts` lines 34–92 (permission requests
    are serialised per session and answered with the tool call's diff);
    `src/acp/tool.ts` lines 38–70 (tool kind mapping) and 259–276 (a shell
    snapshot that did not change is not re-sent); `src/acp/content.ts`
    lines 25–115 (prompt content blocks to the engine's prompt parts).

The protocol SDK, fetched with `npm pack @agentclientprotocol/sdk@1.4.0`:

25. `dist/acp.d.ts` lines 1–60 (`ndJsonStream(output, input)`), 100–215
    (`AgentConnection.client`, `AgentContext.request` and `notify`), 480–560
    (the handler tables: which methods an agent handles, which it calls),
    612–700 (`agent()`, `AgentApp.onConnect/onRequest/onNotification/connect`;
    `AgentSideConnection` is deprecated in this version);
    `dist/schema/types.gen.d.ts` lines 35–260 (`WriteTextFileRequest`,
    `ReadTextFileRequest`, `RequestPermissionRequest`, `ToolCallUpdate`,
    `ToolKind`, `ToolCallStatus`, `ToolCallContent`), 499–800 (`Diff`,
    `Terminal`, `ToolCallLocation`, `PermissionOption`), 1469–1630
    (`InitializeResponse`, `AgentCapabilities`, `PromptCapabilities`),
    2530–2760 (`NewSessionResponse`, `SessionConfigOption` and its select
    groups), 2970–3010 (`PromptResponse`, `StopReason`), 3339–3480 (`Error`,
    `SessionUpdate`), 3942–3960 (`UsageUpdate`), 4148–4300
    (`InitializeRequest`, `ClientCapabilities`); `dist/schema/index.d.ts`
    line 51 (`PROTOCOL_VERSION = 1`); `dist/jsonrpc.d.ts` lines 549–600
    (`RequestError.authRequired()` is `-32000`,
    `RequestError.resourceNotFound()` is `-32002`); `package.json` (peer
    dependency on `zod ^3.25 || ^4`; the runtime imports `zod/v4`).

---

## 1. Design

Problem, trace, solution, per decision. Each rests on lines read above and,
where marked, on three throwaway probes run on 2026-09-11 (deleted afterwards)
whose observations the tests in Tasks 3, 4 and 9 make permanent.

### 1.1 The adapter is a client of the engine

The engine owns inference, tools, extensions and the transcript, and it
already exposes them on loopback HTTP behind a launch token. A second agent
stack inside the adapter would duplicate all of it and would make the later
agent manager impossible: one server, N sessions, one event bus is the whole
point of Phase A (architecture.md §2, "The engine is an HTTP server from day
one"). OpenCode arrived at the same layering: its `acp` command boots its
server and talks to it over an SDK client (`cli/cmd/acp.ts` lines 22–38).

So WP02 adds session routes to the engine and an adapter that uses them. The
adapter runs in one of two modes: with `--connect <url>` it attaches to the
engine the IDE already runs (the token comes from `KNIGHTCODE_ENGINE_TOKEN`
in its environment, never from argv, where `ps` would show it); without, it
starts an engine in-process on a random port and a random token and attaches
to that. Stock-Zed validation uses the second mode.

### 1.2 The editor owns the filesystem, and the engine core is untouched

ACP's `fs/read_text_file` returns the editor's buffer, unsaved edits
included, and records the read in Zed's `ActionLog`; `fs/write_text_file`
diffs the buffer against the new text and applies the difference as an agent
transaction the user can accept or reject hunk by hunk
(`acp_thread.rs` 4310–4517). An engine that writes files directly bypasses
all of that. The tools that touch files are `read`, `edit` and `write`.

Trace: each of those tools takes pluggable operations —
`ReadOperations.readFile/access` (`read.ts` 37–44),
`EditOperations.readFile/writeFile/access` (`edit.ts` 83–90),
`WriteOperations.writeFile/mkdir` (`write.ts` 27–32) — and every operation
receives the absolute path the tool resolved (`read.ts` 102,
`edit.ts` 167, `write.ts` 65). `createAgentSession` accepts `customTools`
(`sdk.ts` 76, 388), and `_refreshToolRegistry` inserts custom tools into the
registry *after* the built-ins keyed by name (`agent-session.ts` 2758–2763),
so a custom tool named `read` replaces the built-in `read`. The prompt
snippet and guidelines come from whichever definition holds the name
(2766–2782); a definition produced by the same `createReadToolDefinition`
carries the same ones.

Verified: a session created with
`customTools: [createReadToolDefinition(cwd, { operations })]` (and edit,
write) has a `systemPrompt` byte-identical to one created without, lists
`read, bash, edit, write` as its active tools, and its `read` and `write`
tools call the injected operations with absolute paths.

Solution: `client-fs.ts` (Task 2) builds the three definitions with
operations that route text through the client and fall back to local disk
only when the client says it does not own the path (a file outside the
project, which Zed rejects with `resource_not_found`; `acp_thread.rs`
4325–4330). Images stay on disk: the client surface is text-only and the
read tool detects images before reading (`read.ts` 107). No file under
`packages/cli/src/core` changes.

### 1.3 Permission is an inline extension

The CLI has no permission system. The only hook that runs before a tool
executes and can stop it is the `tool_call` extension event
(`agent-session.ts` 513–532; `runner.ts` 978–999; `types.ts` 1123–1132).
`DefaultResourceLoader` accepts in-process extensions through
`extensionFactories` (`resource-loader.ts` 168), reachable from
`createAgentSessionServices` via `resourceLoaderOptions` (line 44).

Trace: the loop emits `tool_execution_start`, then calls `prepareToolCall`,
which awaits `beforeToolCall` with no race against the abort signal and
checks `signal.aborted` only afterwards (`agent-loop.ts` 497–505, 626–640).
The handler receives `ctx.signal`, "the current abort signal, or undefined
when the agent is not streaming" (`types.ts` 335–336).

Verified: an inline extension registered through `extensionFactories`
receives `tool_call` for a faux `write` call with `ctx.signal` defined; a
handler that returns `{ block: true }` produces an error tool result and no
write; a handler parked on a promise that also listens on `ctx.signal`
settles when `session.abort()` runs, and the session reports idle with no
write having happened. The last assistant message after that abort carried
`stopReason: "error"`, not `"aborted"`, so the cancelled stop reason must
come from the cancel route's own flag, not from the message.

Solution: `permissions.ts` (Task 3) registers one hidden extension per
session whose handler asks the client and races the answer against
`ctx.signal`. Read-only built-ins (`read`, `grep`, `find`, `ls`) never ask.
`allow_always` is remembered per session and tool name.

### 1.4 Questions travel on the bus, answers travel as POSTs

The adapter is a separate process, so a tool waiting on the editor is a tool
waiting on HTTP. The engine already has this shape for OAuth prompts:
`createLoginRegistry` parks a `prompt()` and resolves it when
`POST .../submit` arrives (`accounts.ts` 187–200, 237–247).

Solution: `client-requests.ts` (Task 1) parks a request under an id,
publishes `session.request` on the bus, and resolves when
`POST /v1/sessions/:id/requests/:requestId` arrives, or rejects when the
turn is aborted or the session closes. Three request kinds: `permission`,
`fs.read`, `fs.write`. A file request carries the tool call that made it
(an `AsyncLocalStorage` scope around the tool's `execute`), so the adapter
can attach the resulting diff to the right tool call even when tools run in
parallel.

### 1.5 A turn ends when the bus says so

The prompt route answers `202` as soon as preflight succeeds, exactly as RPC
mode does through `preflightResult` (`rpc-mode.ts` 391–412), and the turn's
outcome is a `session.turn_end` event published after `session.prompt()`
resolves — which is after `agent_settled`, the last event `_runAgentPrompt`
emits (`agent-session.ts` 1129–1140). Everything the adapter must forward
for the turn has therefore already been delivered on the same SSE
connection when `turn_end` arrives. OpenCode needs `runUntilIdle` for the
same reason (`event.ts` 69–87). If the event stream drops, every pending
turn fails (`event.ts` 171–180); the adapter does the same.

### 1.6 Zed's terminal, without moving execution

Zed renders a live terminal for a tool call in two ways: the agent asks Zed
to run the command (`terminal/create`), or the agent runs it and streams
bytes into a display-only terminal through `_meta` keys that Zed's
`AcpConnection` reads on its own: `terminal_info` on a `tool_call` creates
the terminal, `terminal_output` and `terminal_exit` on a `tool_call_update`
feed it (`acp.rs` 4799–4880; `acp_thread.rs` 4737–4815). The fork reuses
`AcpConnection` unchanged (architecture.md §4.1), so this stays available.

The second way keeps the bash tool exactly as it is — accumulator,
truncation, temp file, timeout, process-tree kill — and turns its throttled
snapshot updates (`bash.ts` 302–357) into terminal output. The adapter sends
the suffix when a snapshot extends the previous one and a clear-screen plus
the whole snapshot when it does not (tail truncation moved the window). The
exit code is `0` on success and parsed from "Command exited with code N"
otherwise. The ceiling: the process runs in the engine, not in Zed's
sandbox, and `terminal/kill` does not apply; cancelling the turn kills it.

### 1.7 The contract Zed enforces

- Protocol version 1 (`acp.rs` 1013, `MINIMUM_SUPPORTED_VERSION`; SDK
  `PROTOCOL_VERSION = 1`). Zed 1.21.0 depends on the `agent-client-protocol`
  crate 2.0.0; that 2.0.0 is the crate version, not the schema. Both sides
  speak schema v1.
- `session/cancel` is a notification; the in-flight `session/prompt` must
  still return, with `stopReason: "cancelled"` (`acp.rs` 1977–1983,
  `acp_thread.rs` 3971–3987). Zed answers its own pending permission
  requests with `cancelled` when it cancels (`acp_thread.rs` 4022–4045); a
  late reply to an already-aborted engine request is therefore normal.
- A permission request carries a `ToolCallUpdate` that Zed upserts; content
  of type `diff` renders as a diff card; `options` are shown as buttons
  (`acp.rs` 4513–4565, `acp_thread.rs` 3433–3468).
- `tool_call_update.content` replaces the content collection. Sending text
  output after a diff would erase the diff.
- Tool call titles are markdown except for `execute`, and `_meta.tool_name`
  names the tool (`acp_thread.rs` 68–76, 892–899).
- The user message is pushed optimistically by Zed; do not echo it.
- Zed spawns the command through the system shell with cwd at the first
  worktree root (`acp.rs` 848–857), and passes `cwd` in `session/new`.

Verified: `@agentclientprotocol/sdk@1.4.0`'s `agent()` / `client().connect(app)`
composition runs in-process under Node 24 against the hoisted `zod` 4.4.3
(`zod/v4` import). `PROTOCOL_VERSION` is `1`. Task 9's harness is this
composition; production is `ndJsonStream` over stdio.

### 1.8 Wire contract

Engine routes added (all behind the launch token, all loopback):

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/v1/sessions` | `{cwd, model?, capabilities?}` | `201` `SessionSummary`; `401 auth_required` when no model can be used |
| `GET` | `/v1/sessions/:id` | | `200` `SessionSummary` |
| `PATCH` | `/v1/sessions/:id` | `{model?, thinkingLevel?}` | `200` `SessionSummary` |
| `DELETE` | `/v1/sessions/:id` | | `204` |
| `POST` | `/v1/sessions/:id/prompt` | `{text, images?}` | `202` once preflight passes; `409 busy`; `401 auth_required` |
| `POST` | `/v1/sessions/:id/cancel` | | `204` |
| `POST` | `/v1/sessions/:id/requests/:requestId` | `ClientReply` | `204`; `404 unknown_request` |

Engine events added to the `/events` stream, every one carrying
`sessionId`: `session.created`, `session.closed`, `session.message`,
`session.delta`, `session.tool_call`, `session.tool_start`,
`session.tool_update`, `session.tool_end`, `session.request`,
`session.turn_end`. Exact shapes are the `SessionEvent` union in Task 4.

ACP surface: `initialize`, `authenticate`, `session/new`, `session/prompt`,
`session/cancel`, `session/close`, `session/set_config_option`; the agent
calls `session/update`, `session/request_permission`, `fs/read_text_file`,
`fs/write_text_file`. Config options are `model` (category `model`, grouped
by provider) and `thinking` (category `thought_level`).

### 1.9 Two lines of architecture.md to amend with this work

- §5 says `/v1/sessions` is deliberately absent from v1. WP02 adds it,
  because the adapter is a client of the engine (§2) and a client needs a
  door. The IDE's agent panel still reaches sessions only through ACP; the
  routes are what the ACP process and, later, the agent manager use. The
  sentence becomes: "`/v1/sessions` serves the ACP adapter and the agent
  manager; the IDE's panel reaches sessions through ACP."
- §4.1 spells the attach command as `acp --connect <url> --token <token>`.
  The token goes in `KNIGHTCODE_ENGINE_TOKEN` instead: argv is readable by
  every process on the machine, and the environment is already how the
  engine itself receives it.

Both are one-line edits to `architecture.md`, made in the same PR.

---

## File structure

```text
packages/cli/src/engine/client-requests.ts   parked engine→client requests, answered by POST
packages/cli/src/engine/client-fs.ts         read/edit/write tools with client-backed operations
packages/cli/src/engine/permissions.ts       the hidden tool_call extension
packages/cli/src/engine/sessions.ts          SessionRegistry: AgentSession per id, event forwarding
packages/cli/src/engine/http.ts              readJsonBody with a limit that fits images
packages/cli/src/engine/session-routes.ts    /v1/sessions routes
packages/cli/src/engine/routes.ts            engineRoutes(ctx, sessions): the one route list
packages/cli/src/engine/events.ts            EngineEvent gains SessionEvent (modify)
packages/cli/src/engine/completions.ts       export resolveModel, sendLookupError (modify)
packages/cli/src/engine-entry.ts             uses engineRoutes; `acp` subcommand (modify)

packages/cli/src/engine/acp/engine-client.ts HTTP + SSE client for the engine
packages/cli/src/engine/acp/content.ts       ACP prompt blocks -> {text, images}, pure
packages/cli/src/engine/acp/tools.ts         tool kind, title, locations, result content, pure
packages/cli/src/engine/acp/updates.ts       SessionEvent -> SessionUpdate[], pure with state
packages/cli/src/engine/acp/agent.ts         the AgentApp: handlers, client requests, config options
packages/cli/src/engine/acp/run.ts           runAcp(argv): stdio, in-process engine, shutdown
packages/cli/src/engine/acp/entry.ts         `bun run` entrypoint for stock Zed

packages/cli/test/engine/client-requests.test.ts
packages/cli/test/engine/client-fs.test.ts
packages/cli/test/engine/permissions.test.ts
packages/cli/test/engine/sessions.test.ts
packages/cli/test/engine/session-routes.test.ts
packages/cli/test/engine/acp/engine-client.test.ts
packages/cli/test/engine/acp/content.test.ts
packages/cli/test/engine/acp/tools.test.ts
packages/cli/test/engine/acp/updates.test.ts
packages/cli/test/engine/acp/agent.test.ts
packages/cli/test/engine/acp/entry.test.ts
```

Budget: OpenCode's adapter is 3,610 lines for the same job. The engine half
here is roughly 1,100 lines and the adapter half roughly 1,300, plus about
1,200 of tests. If a task runs well past its estimate, stop and reconsider
before continuing.

---

## Task 1: Client request registry

**Files:**
- Create: `packages/cli/src/engine/client-requests.ts`
- Modify: `packages/cli/src/engine/events.ts` (the `session.request` event
  only; the rest of the session events land in Task 4)
- Test: `packages/cli/test/engine/client-requests.test.ts`

**Interfaces:**
- Consumes: `EventBus` from `events.ts`.
- Produces:
  - `export type PermissionOutcome = "allow_once" | "allow_always" | "reject_once" | "reject_always" | "cancelled"`
  - `export type ClientRequest = { kind: "permission"; toolCallId: string; toolName: string; input: unknown } | { kind: "fs.read"; toolCallId?: string; path: string } | { kind: "fs.write"; toolCallId?: string; path: string; content: string }`
  - `export type ClientReply = { kind: "permission"; outcome: PermissionOutcome } | { kind: "fs.read"; content: string } | { kind: "fs.write" } | { kind: "error"; code: "not_found" | "failed"; message: string }`
  - `export class ClientRequestAborted extends Error {}`
  - `export interface ClientRequests { ask(sessionId: string, request: ClientRequest, signal?: AbortSignal): Promise<ClientReply>; reply(requestId: string, reply: ClientReply): boolean; abortAll(sessionId: string, reason: string): void; size(): number }`
  - `export function createClientRequests(events: EventBus): ClientRequests`

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/client-requests.test.ts
import { describe, expect, test } from "vitest";
import { ClientRequestAborted, createClientRequests } from "../../src/engine/client-requests.ts";
import { createEventBus, type EngineEvent } from "../../src/engine/events.ts";

function published(seen: EngineEvent[]): Extract<EngineEvent, { type: "session.request" }>[] {
	return seen.filter((event): event is Extract<EngineEvent, { type: "session.request" }> => event.type === "session.request");
}

describe("client requests", () => {
	test("publishes the request and resolves with the reply", async () => {
		const bus = createEventBus();
		const seen: EngineEvent[] = [];
		bus.subscribe((event) => seen.push(event));
		const requests = createClientRequests(bus);

		const pending = requests.ask("s1", { kind: "fs.read", path: "/a.txt" });
		const [event] = published(seen);
		expect(event.sessionId).toBe("s1");
		expect(event.request).toEqual({ kind: "fs.read", path: "/a.txt" });
		expect(requests.size()).toBe(1);

		expect(requests.reply(event.requestId, { kind: "fs.read", content: "hello" })).toBe(true);
		await expect(pending).resolves.toEqual({ kind: "fs.read", content: "hello" });
		expect(requests.size()).toBe(0);
	});

	test("refuses a reply to an unknown or already answered request", async () => {
		const bus = createEventBus();
		const seen: EngineEvent[] = [];
		bus.subscribe((event) => seen.push(event));
		const requests = createClientRequests(bus);
		expect(requests.reply("nope", { kind: "fs.write" })).toBe(false);

		const pending = requests.ask("s1", { kind: "fs.write", path: "/a.txt", content: "x" });
		const [event] = published(seen);
		expect(requests.reply(event.requestId, { kind: "fs.write" })).toBe(true);
		expect(requests.reply(event.requestId, { kind: "fs.write" })).toBe(false);
		await pending;
	});

	test("an aborted signal rejects the parked request", async () => {
		const requests = createClientRequests(createEventBus());
		const controller = new AbortController();
		const pending = requests.ask("s1", { kind: "permission", toolCallId: "t", toolName: "bash", input: {} }, controller.signal);
		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(ClientRequestAborted);
		expect(requests.size()).toBe(0);
	});

	test("an already aborted signal never parks", async () => {
		const requests = createClientRequests(createEventBus());
		const controller = new AbortController();
		controller.abort();
		await expect(
			requests.ask("s1", { kind: "fs.read", path: "/a.txt" }, controller.signal),
		).rejects.toBeInstanceOf(ClientRequestAborted);
		expect(requests.size()).toBe(0);
	});

	test("abortAll rejects only that session's requests", async () => {
		const requests = createClientRequests(createEventBus());
		const mine = requests.ask("s1", { kind: "fs.read", path: "/a.txt" });
		const theirs = requests.ask("s2", { kind: "fs.read", path: "/b.txt" });
		requests.abortAll("s1", "closed");
		await expect(mine).rejects.toThrow("closed");
		expect(requests.size()).toBe(1);
		requests.abortAll("s2", "closed");
		await expect(theirs).rejects.toBeInstanceOf(ClientRequestAborted);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/client-requests.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/client-requests.ts`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/client-requests.ts
/**
 * Requests the engine makes of the client that owns a session.
 *
 * ACP inverts control for permissions and for the filesystem: the agent asks
 * the editor and the editor answers. The adapter that speaks ACP is a
 * separate process reached over HTTP, so the question goes out on the event
 * bus and the answer comes back as a POST. A parked request holds the tool
 * that asked until the answer lands, the turn is aborted, or the session
 * closes. This is the shape `createLoginRegistry` already uses for OAuth
 * prompts.
 */

import { randomUUID } from "node:crypto";
import type { EventBus } from "./events.ts";

export type PermissionOutcome = "allow_once" | "allow_always" | "reject_once" | "reject_always" | "cancelled";

export type ClientRequest =
	| { kind: "permission"; toolCallId: string; toolName: string; input: unknown }
	| { kind: "fs.read"; toolCallId?: string; path: string }
	| { kind: "fs.write"; toolCallId?: string; path: string; content: string };

export type ClientReply =
	| { kind: "permission"; outcome: PermissionOutcome }
	| { kind: "fs.read"; content: string }
	| { kind: "fs.write" }
	/** `not_found` means the client does not own that path; the engine falls back to local disk. */
	| { kind: "error"; code: "not_found" | "failed"; message: string };

export class ClientRequestAborted extends Error {}

export interface ClientRequests {
	/** Publish the request and park until it is answered or aborted. */
	ask(sessionId: string, request: ClientRequest, signal?: AbortSignal): Promise<ClientReply>;
	/** Deliver an answer. False when nothing is parked under that id. */
	reply(requestId: string, reply: ClientReply): boolean;
	/** Reject every parked request for a session. */
	abortAll(sessionId: string, reason: string): void;
	/** Test seam: how many requests are parked. */
	size(): number;
}

interface Parked {
	sessionId: string;
	resolve(reply: ClientReply): void;
	reject(error: Error): void;
	cleanup(): void;
}

export function createClientRequests(events: EventBus): ClientRequests {
	const parked = new Map<string, Parked>();

	function take(requestId: string): Parked | undefined {
		const entry = parked.get(requestId);
		if (!entry) return undefined;
		parked.delete(requestId);
		entry.cleanup();
		return entry;
	}

	return {
		ask(sessionId, request, signal) {
			if (signal?.aborted) return Promise.reject(new ClientRequestAborted("aborted"));
			const requestId = randomUUID();
			return new Promise<ClientReply>((resolve, reject) => {
				const onAbort = () => take(requestId)?.reject(new ClientRequestAborted("aborted"));
				signal?.addEventListener("abort", onAbort, { once: true });
				parked.set(requestId, {
					sessionId,
					resolve,
					reject,
					cleanup: () => signal?.removeEventListener("abort", onAbort),
				});
				// Parked first: a subscriber that answers synchronously must find it.
				events.publish({ type: "session.request", sessionId, requestId, request });
			});
		},
		reply(requestId, reply) {
			const entry = take(requestId);
			if (!entry) return false;
			entry.resolve(reply);
			return true;
		},
		abortAll(sessionId, reason) {
			for (const [requestId, entry] of [...parked]) {
				if (entry.sessionId !== sessionId) continue;
				take(requestId);
				entry.reject(new ClientRequestAborted(reason));
			}
		},
		size: () => parked.size,
	};
}
```

In `events.ts`, add the type import and the variant:

```ts
import type { ClientRequest } from "./client-requests.ts";

export type EngineEvent =
	| { type: "account.changed"; providerId: string; authenticated: boolean }
	| { type: "models.changed" }
	| { type: "session.request"; sessionId: string; requestId: string; request: ClientRequest };
```

The import cycle (`client-requests.ts` imports the `EventBus` type,
`events.ts` imports the `ClientRequest` type) is type-only on both sides.

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/client-requests.test.ts`
Expected: PASS, 5 tests. Also run `test/engine/events.test.ts`: the union
grew, nothing else changed.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/client-requests.ts packages/cli/src/engine/events.ts packages/cli/test/engine/client-requests.test.ts
git commit -m "feat(engine): add parked client requests answered over HTTP"
```

---

## Task 2: Client-backed file operations

**Files:**
- Create: `packages/cli/src/engine/client-fs.ts`
- Test: `packages/cli/test/engine/client-fs.test.ts`

**Interfaces:**
- Consumes: `ClientRequests`, `ClientReply` (Task 1); `ReadOperations`,
  `EditOperations`, `WriteOperations`, `createReadToolDefinition`,
  `createEditToolDefinition`, `createWriteToolDefinition`, `ToolDef` from
  `../core/tools/index.ts`; `detectSupportedImageMimeTypeFromFile` from
  `../utils/mime.ts`.
- Produces:
  - `export interface ClientFileCapabilities { readTextFile: boolean; writeTextFile: boolean }`
  - `export function createClientFileOperations(sessionId: string, requests: ClientRequests, capabilities: ClientFileCapabilities): { read: ReadOperations; edit: EditOperations; write: WriteOperations }`
  - `export function createClientFileTools(cwd: string, sessionId: string, requests: ClientRequests, capabilities: ClientFileCapabilities, options: { autoResizeImages: boolean }): ToolDef[]`

`access` stays local: ACP has no stat, and the edit tool's precondition
(`edit.ts` 173–181) is that the file exists and is writable on disk. The
`autoResizeImages` option exists because the built-in path reads it from
settings (`agent-session.ts` 2829–2840) and a replacement must not silently
change it.

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/client-fs.test.ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createClientFileOperations, createClientFileTools } from "../../src/engine/client-fs.ts";
import type { ClientReply, ClientRequest, ClientRequests } from "../../src/engine/client-requests.ts";

/** A client that answers from a script and records what it was asked. */
function scriptedRequests(answer: (request: ClientRequest) => ClientReply): ClientRequests & { asked: ClientRequest[] } {
	const asked: ClientRequest[] = [];
	return {
		asked,
		ask: async (_sessionId, request) => {
			asked.push(request);
			return answer(request);
		},
		reply: () => false,
		abortAll: () => {},
		size: () => 0,
	};
}

// The shortest header the image detector accepts (`utils/mime.ts` matches "GIF" alone).
const GIF = Buffer.from("GIF89a");
const both = { readTextFile: true, writeTextFile: true };

describe("client file operations", () => {
	const dir = join(tmpdir(), `knightcode-test-client-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);

	beforeEach(() => mkdirSync(dir, { recursive: true }));
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test("reads text through the client with the absolute path", async () => {
		const requests = scriptedRequests(() => ({ kind: "fs.read", content: "from the editor" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "a.txt");
		writeFileSync(file, "from disk");
		expect((await ops.read.readFile(file)).toString("utf-8")).toBe("from the editor");
		expect(requests.asked).toEqual([{ kind: "fs.read", toolCallId: undefined, path: file }]);
	});

	test("reads images from disk, never through the client", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "failed", message: "must not be asked" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "a.gif");
		writeFileSync(file, GIF);
		expect((await ops.read.readFile(file)).equals(GIF)).toBe(true);
		expect(requests.asked).toEqual([]);
	});

	test("falls back to disk when the client does not own the path", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "not_found", message: "outside the project" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "outside.txt");
		writeFileSync(file, "on disk");
		expect((await ops.edit.readFile(file)).toString("utf-8")).toBe("on disk");
		await ops.write.writeFile(file, "rewritten");
		expect(readFileSync(file, "utf-8")).toBe("rewritten");
	});

	test("a failed client read is the tool's error, not a silent disk read", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "failed", message: "editor said no" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "a.txt");
		writeFileSync(file, "on disk");
		await expect(ops.read.readFile(file)).rejects.toThrow("editor said no");
	});

	test("writes through the client and leaves disk alone", async () => {
		const requests = scriptedRequests(() => ({ kind: "fs.write" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "a.txt");
		writeFileSync(file, "before");
		await ops.write.writeFile(file, "after");
		expect(readFileSync(file, "utf-8")).toBe("before");
		expect(requests.asked).toEqual([{ kind: "fs.write", toolCallId: undefined, path: file, content: "after" }]);
	});

	test("uses disk when the client lacks the capability", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "failed", message: "must not be asked" }));
		const ops = createClientFileOperations("s1", requests, { readTextFile: false, writeTextFile: false });
		const file = join(dir, "a.txt");
		writeFileSync(file, "on disk");
		expect((await ops.read.readFile(file)).toString("utf-8")).toBe("on disk");
		await ops.write.writeFile(file, "changed");
		expect(readFileSync(file, "utf-8")).toBe("changed");
		expect(requests.asked).toEqual([]);
	});

	test("a tool's file requests carry its tool call id", async () => {
		const requests = scriptedRequests((request) =>
			request.kind === "fs.read" ? { kind: "fs.read", content: "hello world\n" } : { kind: "fs.write" },
		);
		const [read, edit, write] = createClientFileTools(dir, "s1", requests, both, { autoResizeImages: false });
		writeFileSync(join(dir, "a.txt"), "hello world\n");

		await read.execute("tc-read", { path: "a.txt" });
		await edit.execute("tc-edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] });
		await write.execute("tc-write", { path: "b.txt", content: "new" });

		expect(requests.asked.map((request) => [request.kind, request.toolCallId])).toEqual([
			["fs.read", "tc-read"],
			["fs.read", "tc-edit"],
			["fs.write", "tc-edit"],
			["fs.write", "tc-write"],
		]);
		const edited = requests.asked.find((request) => request.kind === "fs.write" && request.toolCallId === "tc-edit");
		expect(edited?.kind === "fs.write" ? edited.content : undefined).toBe("hello there\n");
	});

	test("the replacement tools keep the built-in names and prompt contributions", () => {
		const tools = createClientFileTools(dir, "s1", scriptedRequests(() => ({ kind: "fs.write" })), both, {
			autoResizeImages: true,
		});
		expect(tools.map((tool) => tool.name)).toEqual(["read", "edit", "write"]);
		for (const tool of tools) {
			expect(typeof tool.promptSnippet).toBe("string");
			expect(tool.promptGuidelines?.length).toBeGreaterThan(0);
		}
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/client-fs.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/client-fs.ts`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/client-fs.ts
/**
 * File operations that ask the editor first.
 *
 * The built-in read, edit and write tools take pluggable operations. These
 * route text through the client that owns the session — the editor's
 * buffers, unsaved changes included — and fall back to local disk only when
 * the client says it does not own the path. Images are bytes, which the
 * text-only client surface cannot carry, so they always come from disk.
 *
 * Registered as `customTools`, the resulting definitions replace the
 * built-ins by name. They are built by the same factories, so the tool
 * descriptions and the system prompt do not change.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { access as fsAccess, mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import {
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type EditOperations,
	type ReadOperations,
	type ToolDef,
	type WriteOperations,
} from "../core/tools/index.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";
import type { ClientReply, ClientRequests } from "./client-requests.ts";

export interface ClientFileCapabilities {
	readTextFile: boolean;
	writeTextFile: boolean;
}

/** The tool call currently executing, so a file request can be attributed to it. */
const currentToolCall = new AsyncLocalStorage<string>();

function unexpected(reply: ClientReply): never {
	throw new Error(reply.kind === "error" ? reply.message : `unexpected reply: ${reply.kind}`);
}

export function createClientFileOperations(
	sessionId: string,
	requests: ClientRequests,
	capabilities: ClientFileCapabilities,
): { read: ReadOperations; edit: EditOperations; write: WriteOperations } {
	async function readFile(absolutePath: string): Promise<Buffer> {
		if (!capabilities.readTextFile || (await detectSupportedImageMimeTypeFromFile(absolutePath))) {
			return fsReadFile(absolutePath);
		}
		const reply = await requests.ask(sessionId, {
			kind: "fs.read",
			toolCallId: currentToolCall.getStore(),
			path: absolutePath,
		});
		if (reply.kind === "fs.read") return Buffer.from(reply.content, "utf-8");
		if (reply.kind === "error" && reply.code === "not_found") return fsReadFile(absolutePath);
		return unexpected(reply);
	}

	async function writeFile(absolutePath: string, content: string): Promise<void> {
		if (!capabilities.writeTextFile) return fsWriteFile(absolutePath, content, "utf-8");
		const reply = await requests.ask(sessionId, {
			kind: "fs.write",
			toolCallId: currentToolCall.getStore(),
			path: absolutePath,
			content,
		});
		if (reply.kind === "fs.write") return;
		if (reply.kind === "error" && reply.code === "not_found") return fsWriteFile(absolutePath, content, "utf-8");
		return unexpected(reply);
	}

	return {
		read: {
			readFile,
			access: (path) => fsAccess(path, constants.R_OK),
			detectImageMimeType: detectSupportedImageMimeTypeFromFile,
		},
		edit: {
			readFile,
			writeFile,
			access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
		},
		write: {
			writeFile,
			mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
		},
	};
}

/** Run a definition's execute inside a scope that names the tool call. */
function scoped(definition: ToolDef): ToolDef {
	return {
		...definition,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			currentToolCall.run(toolCallId, () => definition.execute(toolCallId, params, signal, onUpdate, ctx)),
	};
}

export function createClientFileTools(
	cwd: string,
	sessionId: string,
	requests: ClientRequests,
	capabilities: ClientFileCapabilities,
	options: { autoResizeImages: boolean },
): ToolDef[] {
	const ops = createClientFileOperations(sessionId, requests, capabilities);
	return [
		scoped(createReadToolDefinition(cwd, { operations: ops.read, autoResizeImages: options.autoResizeImages })),
		scoped(createEditToolDefinition(cwd, { operations: ops.edit })),
		scoped(createWriteToolDefinition(cwd, { operations: ops.write })),
	];
}
```

If `ToolDef`'s `execute` signature makes the spread-and-override in
`scoped` fail to type, mirror `createToolDefinitionFromAgentTool` in
`tools/tool-definition-wrapper.ts` (explicit fields) rather than casting.

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/client-fs.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/client-fs.ts packages/cli/test/engine/client-fs.test.ts
git commit -m "feat(engine): route read, edit and write through the session's client"
```

---

## Task 3: Permission extension

**Files:**
- Create: `packages/cli/src/engine/permissions.ts`
- Test: `packages/cli/test/engine/permissions.test.ts`

**Interfaces:**
- Consumes: `ClientRequests`, `ClientReply`, `ClientRequestAborted` (Task 1);
  `InlineExtension` from `../core/extensions/index.ts`.
- Produces:
  - `export function needsPermission(toolName: string): boolean`
  - `export function createPermissionExtension(sessionId: string, requests: ClientRequests): InlineExtension`

The handler must release itself when the turn aborts: the loop awaits it
outright (`agent-loop.ts` 626–640). `requests.ask` takes `ctx.signal` for
that. The test drives a real `AgentSession` through the same services the
registry will use, so what it proves is what production runs.

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/permissions.test.ts
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, type FauxProviderHandle, fauxText, fauxToolCall } from "@knightcode/ai";
import type { ToolResultMessage } from "@knightcode/ai";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../../src/core/agent-session-services.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { type ClientRequests, createClientRequests } from "../../src/engine/client-requests.ts";
import { createEngineContext } from "../../src/engine/context.ts";
import { type EngineEvent } from "../../src/engine/events.ts";
import { createPermissionExtension } from "../../src/engine/permissions.ts";

type RequestEvent = Extract<EngineEvent, { type: "session.request" }>;

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("permission extension", () => {
	let counter = 0;
	const dirs: string[] = [];
	let session: AgentSession | undefined;

	afterEach(() => {
		session?.dispose();
		session = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(): Promise<{
		cwd: string;
		faux: FauxProviderHandle;
		requests: ClientRequests;
		permissions: RequestEvent[];
		allRequests: RequestEvent[];
	}> {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-permissions-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-permissions-agent-"));
		dirs.push(cwd, agentDir);
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-permissions-${counter++}` });
		ctx.models.registerNativeProvider(faux.provider);
		const allRequests: RequestEvent[] = [];
		ctx.events.subscribe((event) => {
			if (event.type === "session.request") allRequests.push(event);
		});
		const requests = createClientRequests(ctx.events);
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			modelRuntime: ctx.models,
			resourceLoaderOptions: { extensionFactories: [createPermissionExtension("s1", requests)] },
		});
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(cwd),
			model: faux.getModel(),
		});
		session = created.session;
		const permissions = allRequests;
		return { cwd, faux, requests, permissions, allRequests };
	}

	function toolResult(): ToolResultMessage | undefined {
		return session?.messages.find((message): message is ToolResultMessage => message.role === "toolResult");
	}

	test("holds the tool until the client answers, and a rejection fails only that call", async () => {
		const { cwd, faux, requests, permissions } = await start();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("carried on")]),
		]);
		const turn = session!.prompt("write a file", { source: "rpc" });
		await until(() => permissions.length === 1);
		const [request] = permissions;
		expect(request.request).toMatchObject({ kind: "permission", toolName: "write" });
		expect(session!.isStreaming).toBe(true);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);

		expect(requests.reply(request.requestId, { kind: "permission", outcome: "reject_once" })).toBe(true);
		await turn;
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
		expect(toolResult()?.isError).toBe(true);
		expect(JSON.stringify(toolResult()?.content)).toContain("rejected");
		expect(session!.getLastAssistantText()).toBe("carried on");
	});

	test("allow_always answers the next call of the same tool without asking", async () => {
		const { cwd, faux, requests, permissions } = await start();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "one" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("write", { path: "b.txt", content: "two" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		const turn = session!.prompt("write two files", { source: "rpc" });
		await until(() => permissions.length === 1);
		requests.reply(permissions[0].requestId, { kind: "permission", outcome: "allow_always" });
		await turn;
		expect(permissions.length).toBe(1);
		expect(existsSync(join(cwd, "a.txt"))).toBe(true);
		expect(existsSync(join(cwd, "b.txt"))).toBe(true);
	});

	test("a read never asks", async () => {
		const { cwd, faux, allRequests } = await start();
		writeFileSync(join(cwd, "a.txt"), "content");
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("read it")]),
		]);
		await session!.prompt("read a file", { source: "rpc" });
		expect(allRequests).toEqual([]);
		expect(toolResult()?.isError).toBe(false);
	});

	test("aborting the turn releases a pending permission and runs nothing", async () => {
		const { cwd, faux, requests, permissions } = await start();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("never")]),
		]);
		const turn = session!.prompt("write a file", { source: "rpc" });
		await until(() => permissions.length === 1);
		const settled = Promise.all([turn, session!.abort()]);
		await Promise.race([
			settled,
			new Promise((_, reject) => setTimeout(() => reject(new Error("abort did not settle the turn")), 3000)),
		]);
		expect(session!.isIdle).toBe(true);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
		expect(requests.size()).toBe(0);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/permissions.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/permissions.ts`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/permissions.ts
/**
 * Permission gate, as an inline extension.
 *
 * The CLI has no permission system of its own: the only interception point
 * before a tool runs is the `tool_call` extension event, whose handler may
 * block the call. The engine registers one hidden inline extension per
 * session that turns that event into a client request and blocks when the
 * answer is anything but allow.
 */

import type { InlineExtension } from "../core/extensions/index.ts";
import { ClientRequestAborted, type ClientReply, type ClientRequests } from "./client-requests.ts";

/** Built-in tools that only read never ask; everything else does. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls"]);

export function needsPermission(toolName: string): boolean {
	return !READ_ONLY_TOOLS.has(toolName);
}

export function createPermissionExtension(sessionId: string, requests: ClientRequests): InlineExtension {
	const alwaysAllowed = new Set<string>();
	return {
		name: "engine-permissions",
		hidden: true,
		factory: (knightcode) => {
			knightcode.on("tool_call", async (event, ctx) => {
				if (!needsPermission(event.toolName) || alwaysAllowed.has(event.toolName)) return undefined;
				let reply: ClientReply;
				try {
					// The loop awaits this handler outright, so the request has to release itself
					// on abort or a cancelled turn never settles.
					reply = await requests.ask(
						sessionId,
						{ kind: "permission", toolCallId: event.toolCallId, toolName: event.toolName, input: event.input },
						ctx.signal,
					);
				} catch (error) {
					if (error instanceof ClientRequestAborted) return { block: true, reason: "Tool call cancelled" };
					throw error;
				}
				if (reply.kind !== "permission") return { block: true, reason: "Permission request failed" };
				if (reply.outcome === "allow_always") alwaysAllowed.add(event.toolName);
				if (reply.outcome === "allow_always" || reply.outcome === "allow_once") return undefined;
				return {
					block: true,
					reason: reply.outcome === "cancelled" ? "Tool call cancelled" : "The user rejected this tool call",
				};
			});
		},
	};
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/permissions.test.ts`
Expected: PASS, 4 tests. If the abort test times out, the handler is not
racing `ctx.signal`; do not lengthen the timeout.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/permissions.ts packages/cli/test/engine/permissions.test.ts
git commit -m "feat(engine): gate tool calls on a client permission request"
```

---

## Task 4: Session registry

**Files:**
- Create: `packages/cli/src/engine/sessions.ts`
- Modify: `packages/cli/src/engine/events.ts` (the full `SessionEvent` union)
- Test: `packages/cli/test/engine/sessions.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `createAgentSessionServices`,
  `createAgentSessionFromServices`; `SessionManager`,
  `getDefaultSessionDir`; `emitSessionShutdownEvent`; `getAgentDir` from
  `../config.ts`; `EngineContext`.
- Produces, in `events.ts`:
  - `export type ToolContent = TextContent | ImageContent`
  - `export type TurnStopReason = "end_turn" | "max_tokens" | "cancelled" | "error"`
  - `export interface SessionUsage { used: number | null; size: number; cost: number }`
  - `export type SessionEvent = ...` (below); `EngineEvent` becomes the
    account events `| SessionEvent`.
- Produces, in `sessions.ts`:
  - `export class SessionError extends Error { readonly code: "not_found" | "busy" | "auth_required" | "bad_request" }`
  - `export interface SessionModelSummary { ref: string; providerId: string; id: string; name: string; contextWindow: number }`
  - `export interface SessionSummary { id: string; cwd: string; model?: SessionModelSummary; thinkingLevel: ThinkingLevel; thinkingLevels: ThinkingLevel[] }`
  - `export interface CreateSessionOptions { cwd: string; model?: Model<Api>; capabilities?: Partial<ClientFileCapabilities> }`
  - `export interface PromptInput { text: string; images?: ImageContent[] }`
  - `export interface SessionPatch { model?: Model<Api>; thinkingLevel?: ThinkingLevel }`
  - `export interface CreateSessionRegistryOptions { agentDir?: string; sessionDir?: string | null; defaultModel?: Model<Api> }`
  - `export interface SessionRegistry { create(options): Promise<SessionSummary>; summary(id): SessionSummary | undefined; prompt(id, input): Promise<void>; cancel(id): Promise<boolean>; update(id, patch): Promise<SessionSummary>; reply(id, requestId, reply): boolean; close(id): Promise<boolean>; closeAll(): Promise<void>; size(): number }`
  - `export function createSessionRegistry(ctx: EngineContext, options?: CreateSessionRegistryOptions): SessionRegistry`

`prompt` resolves when preflight passes and the turn is running; the
outcome is a `session.turn_end` event, published after every other event of
the turn. `cancel` sets a flag and aborts; the flag decides the stop reason,
because the message left behind by an abort says `error` as often as
`aborted` (§1.3). `defaultModel` is what tests use to pin the faux provider;
production leaves it unset and `createAgentSession` resolves the CLI's
default (`sdk.ts` 196–233).

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/sessions.test.ts
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@knightcode/ai";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext } from "../../src/engine/context.ts";
import type { EngineEvent } from "../../src/engine/events.ts";
import { createSessionRegistry, SessionError, type SessionRegistry } from "../../src/engine/sessions.ts";

type Of<T extends EngineEvent["type"]> = Extract<EngineEvent, { type: T }>;

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("session registry", () => {
	let counter = 0;
	const dirs: string[] = [];
	let registry: SessionRegistry | undefined;

	afterEach(async () => {
		await registry?.closeAll();
		registry = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(options: { tokensPerSecond?: number } = {}) {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-sessions-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-sessions-agent-"));
		dirs.push(cwd, agentDir);
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-sessions-${counter++}`, tokensPerSecond: options.tokensPerSecond });
		ctx.models.registerNativeProvider(faux.provider);
		const seen: EngineEvent[] = [];
		ctx.events.subscribe((event) => seen.push(event));
		// defaultModel pins every session to the faux provider. The root .env is
		// auto-loaded and carries real keys; an unpinned session could bill them.
		const created = createSessionRegistry(ctx, { agentDir, sessionDir: null, defaultModel: faux.getModel() });
		registry = created;
		const events = <T extends EngineEvent["type"]>(type: T): Of<T>[] =>
			seen.filter((event): event is Of<T> => event.type === type);
		const requestsOf = (kind: string) => events("session.request").filter((event) => event.request.kind === kind);
		const turnEnd = async (): Promise<Of<"session.turn_end">> => {
			await until(() => events("session.turn_end").length > 0);
			return events("session.turn_end").at(-1)!;
		};
		return { cwd, faux, seen, registry: created, events, requestsOf, turnEnd };
	}

	const both = { readTextFile: true, writeTextFile: true };

	test("creates a session on the pinned model and announces it", async () => {
		const { cwd, faux, registry, events } = await start();
		const summary = await registry.create({ cwd });
		expect(summary.model?.ref).toBe(`${faux.provider.id}/${faux.getModel().id}`);
		expect(summary.thinkingLevels.length).toBeGreaterThan(0);
		expect(events("session.created")).toEqual([{ type: "session.created", sessionId: summary.id, cwd: summary.cwd }]);
		expect(registry.summary(summary.id)).toEqual(summary);
		expect(registry.size()).toBe(1);
	});

	test("a prompt streams deltas under one message id and ends with turn_end last", async () => {
		const { cwd, faux, registry, seen, events, turnEnd } = await start();
		const { id } = await registry.create({ cwd });
		faux.setResponses([fauxAssistantMessage([fauxText("hello there friend")])]);
		await registry.prompt(id, { text: "hi" });
		const end = await turnEnd();

		expect(end).toMatchObject({ sessionId: id, stopReason: "end_turn" });
		expect(end.usage?.size).toBe(faux.getModel().contextWindow);
		const [message] = events("session.message");
		const deltas = events("session.delta");
		expect(deltas.length).toBeGreaterThan(1);
		expect(deltas.every((delta) => delta.messageId === message.messageId)).toBe(true);
		expect(deltas.map((delta) => delta.delta).join("")).toBe("hello there friend");
		expect(seen.at(-1)?.type).toBe("session.turn_end");
	});

	test("a second prompt during a turn is refused as busy", async () => {
		const { cwd, faux, registry, turnEnd } = await start({ tokensPerSecond: 20 });
		const { id } = await registry.create({ cwd });
		faux.setResponses([fauxAssistantMessage([fauxText("a".repeat(400))])]);
		await registry.prompt(id, { text: "slow" });
		await expect(registry.prompt(id, { text: "again" })).rejects.toMatchObject({ code: "busy" });
		await registry.cancel(id);
		await turnEnd();
	});

	test("an edit reads and writes through the client, attributed to its tool call", async () => {
		const { cwd, faux, registry, events, requestsOf, turnEnd } = await start();
		writeFileSync(join(cwd, "a.txt"), "hello world\n");
		const { id } = await registry.create({ cwd, capabilities: both });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxText("edited")]),
		]);
		await registry.prompt(id, { text: "edit it" });

		await until(() => requestsOf("permission").length === 1);
		const permission = requestsOf("permission")[0];
		const [toolCall] = events("session.tool_call");
		expect(permission.request).toMatchObject({ kind: "permission", toolCallId: toolCall.toolCallId, toolName: "edit" });
		registry.reply(id, permission.requestId, { kind: "permission", outcome: "allow_once" });

		await until(() => requestsOf("fs.read").length === 1);
		const read = requestsOf("fs.read")[0];
		expect(read.request).toEqual({ kind: "fs.read", toolCallId: toolCall.toolCallId, path: join(cwd, "a.txt") });
		registry.reply(id, read.requestId, { kind: "fs.read", content: "hello world\n" });

		await until(() => requestsOf("fs.write").length === 1);
		const write = requestsOf("fs.write")[0];
		expect(write.request).toEqual({
			kind: "fs.write",
			toolCallId: toolCall.toolCallId,
			path: join(cwd, "a.txt"),
			content: "hello there\n",
		});
		registry.reply(id, write.requestId, { kind: "fs.write" });

		const end = await turnEnd();
		expect(end.stopReason).toBe("end_turn");
		expect(readFileSync(join(cwd, "a.txt"), "utf-8")).toBe("hello world\n");
		expect(events("session.tool_end")[0]).toMatchObject({ toolCallId: toolCall.toolCallId, isError: false });

		// The order the loop guarantees: the call is announced, execution starts,
		// permission is asked, the tool reads then writes, the call ends.
		const watched: readonly string[] = ["session.tool_call", "session.tool_start", "session.request", "session.tool_end"];
		const sequence = seen
			.filter((event) => watched.includes(event.type))
			.map((event) => (event.type === "session.request" ? `session.request:${event.request.kind}` : event.type));
		expect(sequence).toEqual([
			"session.tool_call",
			"session.tool_start",
			"session.request:permission",
			"session.request:fs.read",
			"session.request:fs.write",
			"session.tool_end",
		]);
	});

	test("a denied permission fails only that call and the turn goes on", async () => {
		const { cwd, faux, registry, events, requestsOf, turnEnd } = await start();
		const { id } = await registry.create({ cwd, capabilities: both });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("carried on")]),
		]);
		await registry.prompt(id, { text: "write" });
		await until(() => requestsOf("permission").length === 1);
		registry.reply(id, requestsOf("permission")[0].requestId, { kind: "permission", outcome: "reject_once" });
		const end = await turnEnd();
		expect(end.stopReason).toBe("end_turn");
		expect(events("session.tool_end")[0].isError).toBe(true);
		expect(requestsOf("fs.write")).toEqual([]);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
		expect(events("session.delta").map((delta) => delta.delta).join("")).toBe("carried on");
	});

	test("cancel ends the turn as cancelled and the session takes the next prompt", async () => {
		const { cwd, faux, registry, events, turnEnd } = await start({ tokensPerSecond: 20 });
		const { id } = await registry.create({ cwd });
		faux.setResponses([fauxAssistantMessage([fauxText("b".repeat(400))])]);
		await registry.prompt(id, { text: "slow" });
		await until(() => events("session.delta").length > 0);
		expect(await registry.cancel(id)).toBe(true);
		expect((await turnEnd()).stopReason).toBe("cancelled");

		faux.setResponses([fauxAssistantMessage([fauxText("again")])]);
		await registry.prompt(id, { text: "next" });
		await until(() => events("session.turn_end").length === 2);
		expect(events("session.turn_end")[1].stopReason).toBe("end_turn");
	});

	test("close rejects parked requests and announces the close", async () => {
		const { cwd, faux, registry, events, requestsOf } = await start();
		const { id } = await registry.create({ cwd, capabilities: both });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("never")]),
		]);
		await registry.prompt(id, { text: "write" });
		await until(() => requestsOf("permission").length === 1);
		const { requestId } = requestsOf("permission")[0];
		expect(await registry.close(id)).toBe(true);
		expect(events("session.closed")).toEqual([{ type: "session.closed", sessionId: id }]);
		expect(registry.size()).toBe(0);
		expect(() => registry.reply(id, requestId, { kind: "permission", outcome: "allow_once" })).toThrow(SessionError);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
	});

	test("without client capabilities the tools use disk and no file requests are made", async () => {
		const { cwd, faux, registry, requestsOf, turnEnd } = await start();
		const { id } = await registry.create({ cwd });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await registry.prompt(id, { text: "write" });
		await until(() => requestsOf("permission").length === 1);
		registry.reply(id, requestsOf("permission")[0].requestId, { kind: "permission", outcome: "allow_once" });
		await turnEnd();
		expect(readFileSync(join(cwd, "a.txt"), "utf-8")).toBe("hello");
		expect(requestsOf("fs.read")).toEqual([]);
		expect(requestsOf("fs.write")).toEqual([]);
	});

	test("update switches thinking level and reports it", async () => {
		const { cwd, registry } = await start();
		const { id, thinkingLevels } = await registry.create({ cwd });
		const target = thinkingLevels.find((level) => level !== "medium") ?? "off";
		const updated = await registry.update(id, { thinkingLevel: target });
		expect(updated.thinkingLevel).toBe(target);
		await expect(registry.update("nope", {})).rejects.toMatchObject({ code: "not_found" });
	});
});
```

The chain `tool_call, tool_start, permission, fs.read, fs.write, tool_end`
is the order the loop guarantees (`agent-loop.ts` 497–535; `edit.ts`
173–200). The `edit` test also needs `a.txt` on disk because the edit
tool's `access` check is local (Task 2); the content the tool sees is what
the client replies, and the file on disk is untouched afterwards.

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/sessions.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/sessions.ts`.

- [x] **Step 3: Write minimal implementation**

In `events.ts`, replace the union from Task 1 with:

```ts
import type { ImageContent, TextContent } from "@knightcode/ai";
import type { ClientRequest } from "./client-requests.ts";

export type ToolContent = TextContent | ImageContent;
export type TurnStopReason = "end_turn" | "max_tokens" | "cancelled" | "error";

export interface SessionUsage {
	/** Estimated tokens in context, or null right after a compaction. */
	used: number | null;
	size: number;
	/** Cumulative session cost in USD. */
	cost: number;
}

/**
 * One session's life on the bus. Every variant carries the session id, so a
 * subscriber that follows many sessions demultiplexes on it and one that
 * follows none ignores them all.
 */
export type SessionEvent =
	| { type: "session.created"; sessionId: string; cwd: string }
	| { type: "session.closed"; sessionId: string }
	| { type: "session.message"; sessionId: string; messageId: string }
	| { type: "session.delta"; sessionId: string; messageId: string; kind: "text" | "thinking"; delta: string }
	| { type: "session.tool_call"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
	| { type: "session.tool_start"; sessionId: string; toolCallId: string; toolName: string; args: unknown }
	| {
			type: "session.tool_update";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			content: ToolContent[];
			details: unknown;
	  }
	| {
			type: "session.tool_end";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			args: unknown;
			content: ToolContent[];
			details: unknown;
			isError: boolean;
	  }
	| { type: "session.request"; sessionId: string; requestId: string; request: ClientRequest }
	| { type: "session.turn_end"; sessionId: string; stopReason: TurnStopReason; usage?: SessionUsage; error?: string };

export type EngineEvent =
	| { type: "account.changed"; providerId: string; authenticated: boolean }
	| { type: "models.changed" }
	| SessionEvent;
```

```ts
// packages/cli/src/engine/sessions.ts
/**
 * Engine sessions.
 *
 * One `AgentSession` per id, built the way the CLI builds its own over the
 * engine's `ModelRuntime`, so the shared credential store and the user's
 * extensions, skills and settings apply unchanged. What differs is who owns
 * the filesystem: the read, edit and write tools are replaced by
 * client-backed ones, and a hidden extension asks the client before any
 * tool that is not read-only runs.
 *
 * Every session event is published on the engine bus with its session id.
 * The ACP adapter is one subscriber; the agent manager will be another.
 */

import { randomUUID } from "node:crypto";
import type { ThinkingLevel } from "@knightcode/agent";
import type { Api, AssistantMessage, ImageContent, Model } from "@knightcode/ai";
import { getAgentDir } from "../config.ts";
import type { AgentSession, AgentSessionEvent } from "../core/agent-session.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../core/agent-session-services.ts";
import { emitSessionShutdownEvent } from "../core/extensions/runner.ts";
import { getDefaultSessionDir, SessionManager } from "../core/session-manager.ts";
import { type ClientFileCapabilities, createClientFileTools } from "./client-fs.ts";
import { type ClientReply, createClientRequests } from "./client-requests.ts";
import type { EngineContext } from "./context.ts";
import type { SessionUsage, ToolContent, TurnStopReason } from "./events.ts";
import { createPermissionExtension } from "./permissions.ts";

export class SessionError extends Error {
	readonly code: "not_found" | "busy" | "auth_required" | "bad_request";

	constructor(code: SessionError["code"], message: string) {
		super(message);
		this.code = code;
	}
}

export interface SessionModelSummary {
	ref: string;
	providerId: string;
	id: string;
	name: string;
	contextWindow: number;
}

export interface SessionSummary {
	id: string;
	cwd: string;
	model?: SessionModelSummary;
	thinkingLevel: ThinkingLevel;
	thinkingLevels: ThinkingLevel[];
}

export interface CreateSessionOptions {
	cwd: string;
	model?: Model<Api>;
	/** What the client can do for the session. Absent means the tools use local disk. */
	capabilities?: Partial<ClientFileCapabilities>;
}

export interface PromptInput {
	text: string;
	images?: ImageContent[];
}

export interface SessionPatch {
	model?: Model<Api>;
	thinkingLevel?: ThinkingLevel;
}

export interface SessionRegistry {
	create(options: CreateSessionOptions): Promise<SessionSummary>;
	summary(id: string): SessionSummary | undefined;
	/** Resolves once the prompt passed preflight; the outcome is a `session.turn_end` event. */
	prompt(id: string, input: PromptInput): Promise<void>;
	cancel(id: string): Promise<boolean>;
	update(id: string, patch: SessionPatch): Promise<SessionSummary>;
	reply(id: string, requestId: string, reply: ClientReply): boolean;
	close(id: string): Promise<boolean>;
	closeAll(): Promise<void>;
	size(): number;
}

export interface CreateSessionRegistryOptions {
	/** The CLI's agent directory: settings, extensions, skills. Tests pass a temp dir. */
	agentDir?: string;
	/** Where transcripts persist. `null` keeps them in memory. Tests pass null. */
	sessionDir?: string | null;
	/**
	 * The model a session starts on when the request names none. Production
	 * leaves this unset and the CLI's default resolution applies. Tests set
	 * it: the root .env is auto-loaded with real keys, and an unpinned session
	 * would bill them on its first prompt.
	 */
	defaultModel?: Model<Api>;
}

interface Entry {
	id: string;
	cwd: string;
	session: AgentSession;
	cancelled: boolean;
	messageId: string;
	unsubscribe(): void;
}

function modelSummary(model: Model<Api> | undefined): SessionModelSummary | undefined {
	if (!model) return undefined;
	return {
		ref: `${model.provider}/${model.id}`,
		providerId: model.provider,
		id: model.id,
		name: model.name,
		contextWindow: model.contextWindow,
	};
}

function usageOf(session: AgentSession): SessionUsage | undefined {
	const context = session.getContextUsage();
	if (!context) return undefined;
	return { used: context.tokens, size: context.contextWindow, cost: session.getSessionStats().cost };
}

function contentOf(result: unknown): ToolContent[] {
	const content = typeof result === "object" && result !== null ? (result as { content?: unknown }).content : undefined;
	return Array.isArray(content) ? (content as ToolContent[]) : [];
}

function detailsOf(result: unknown): unknown {
	return typeof result === "object" && result !== null ? (result as { details?: unknown }).details : undefined;
}

/**
 * What the last assistant message says about how the turn ended. An abort
 * leaves `error` behind as often as `aborted`, so the caller consults its
 * own cancelled flag first.
 */
function stopReasonOf(session: AgentSession): { stopReason: TurnStopReason; error?: string } {
	const last = [...session.messages]
		.reverse()
		.find((message): message is AssistantMessage => message.role === "assistant");
	if (!last) return { stopReason: "end_turn" };
	if (last.stopReason === "length") return { stopReason: "max_tokens" };
	if (last.stopReason === "error" || last.stopReason === "aborted") {
		return { stopReason: "error", error: last.errorMessage ?? "the turn failed" };
	}
	return { stopReason: "end_turn" };
}

export function createSessionRegistry(ctx: EngineContext, options: CreateSessionRegistryOptions = {}): SessionRegistry {
	const entries = new Map<string, Entry>();
	const requests = createClientRequests(ctx.events);
	const agentDir = options.agentDir ?? getAgentDir();

	function get(id: string): Entry {
		const entry = entries.get(id);
		if (!entry) throw new SessionError("not_found", `unknown session: ${id}`);
		return entry;
	}

	function summarize(entry: Entry): SessionSummary {
		const { session } = entry;
		return {
			id: entry.id,
			cwd: entry.cwd,
			model: modelSummary(session.model),
			thinkingLevel: session.thinkingLevel,
			thinkingLevels: session.getAvailableThinkingLevels(),
		};
	}

	function forward(entry: Entry, event: AgentSessionEvent): void {
		const sessionId = entry.id;
		switch (event.type) {
			case "message_start":
				if (event.message.role !== "assistant") return;
				entry.messageId = randomUUID();
				ctx.events.publish({ type: "session.message", sessionId, messageId: entry.messageId });
				return;
			case "message_update": {
				const inner = event.assistantMessageEvent;
				if (inner.type === "text_delta" || inner.type === "thinking_delta") {
					ctx.events.publish({
						type: "session.delta",
						sessionId,
						messageId: entry.messageId,
						kind: inner.type === "text_delta" ? "text" : "thinking",
						delta: inner.delta,
					});
				} else if (inner.type === "toolcall_end") {
					ctx.events.publish({
						type: "session.tool_call",
						sessionId,
						toolCallId: inner.toolCall.id,
						toolName: inner.toolCall.name,
						args: inner.toolCall.arguments,
					});
				}
				return;
			}
			case "tool_execution_start":
				ctx.events.publish({
					type: "session.tool_start",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
				});
				return;
			case "tool_execution_update":
				ctx.events.publish({
					type: "session.tool_update",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					content: contentOf(event.partialResult),
					details: detailsOf(event.partialResult),
				});
				return;
			case "tool_execution_end":
				ctx.events.publish({
					type: "session.tool_end",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
					content: contentOf(event.result),
					details: detailsOf(event.result),
					isError: event.isError,
				});
				return;
			default:
				return;
		}
	}

	function finishTurn(entry: Entry, error?: unknown): void {
		// Closed mid-turn: the closed event already went out and nobody waits for this one.
		if (entries.get(entry.id) !== entry) return;
		const outcome = entry.cancelled
			? { stopReason: "cancelled" as const }
			: error !== undefined
				? { stopReason: "error" as const, error: error instanceof Error ? error.message : String(error) }
				: stopReasonOf(entry.session);
		ctx.events.publish({ type: "session.turn_end", sessionId: entry.id, ...outcome, usage: usageOf(entry.session) });
	}

	async function close(id: string): Promise<boolean> {
		const entry = entries.get(id);
		if (!entry) return false;
		entries.delete(id);
		entry.cancelled = true;
		requests.abortAll(id, "closed");
		entry.unsubscribe();
		// Same order as AgentSessionRuntime.teardownCurrent: settle the turn, tell
		// extensions, then dispose.
		await entry.session.abort();
		await emitSessionShutdownEvent(entry.session.extensionRunner, { type: "session_shutdown", reason: "quit" });
		entry.session.dispose();
		ctx.events.publish({ type: "session.closed", sessionId: id });
		return true;
	}

	return {
		async create(request) {
			const capabilities: ClientFileCapabilities = {
				readTextFile: request.capabilities?.readTextFile === true,
				writeTextFile: request.capabilities?.writeTextFile === true,
			};
			const sessionManager =
				options.sessionDir === null
					? SessionManager.inMemory(request.cwd)
					: SessionManager.create(request.cwd, options.sessionDir ?? getDefaultSessionDir(request.cwd, agentDir));
			const id = sessionManager.getSessionId();
			const services = await createAgentSessionServices({
				cwd: request.cwd,
				agentDir,
				modelRuntime: ctx.models,
				resourceLoaderOptions: { extensionFactories: [createPermissionExtension(id, requests)] },
			});
			const { session } = await createAgentSessionFromServices({
				services,
				sessionManager,
				model: request.model ?? options.defaultModel,
				customTools: createClientFileTools(services.cwd, id, requests, capabilities, {
					autoResizeImages: services.settingsManager.getImageAutoResize(),
				}),
			});
			if (!session.model) {
				session.dispose();
				throw new SessionError("auth_required", "no model is available; sign in first");
			}
			const entry: Entry = { id, cwd: services.cwd, session, cancelled: false, messageId: "", unsubscribe: () => {} };
			entry.unsubscribe = session.subscribe((event) => forward(entry, event));
			entries.set(id, entry);
			ctx.events.publish({ type: "session.created", sessionId: id, cwd: services.cwd });
			return summarize(entry);
		},

		summary(id) {
			const entry = entries.get(id);
			return entry ? summarize(entry) : undefined;
		},

		async prompt(id, input) {
			const entry = get(id);
			const { session } = entry;
			if (session.isStreaming) throw new SessionError("busy", "the session is already running a turn");
			const model = session.model;
			if (!model) throw new SessionError("auth_required", "no model selected");
			// The check prompt() makes at agent-session.ts:1266-1282, made here so
			// the failure is a status code rather than a message to match on.
			if (!ctx.models.hasConfiguredAuth(model.provider) && (await ctx.models.checkAuth(model.provider)) === undefined) {
				throw new SessionError("auth_required", `not signed in to ${model.provider}`);
			}
			entry.cancelled = false;
			let started = false;
			await new Promise<void>((resolve, reject) => {
				session
					.prompt(input.text, {
						images: input.images,
						source: "rpc",
						preflightResult: (ok) => {
							if (!ok) return;
							started = true;
							resolve();
						},
					})
					.then(() => finishTurn(entry))
					.catch((error: unknown) => {
						if (started) finishTurn(entry, error);
						else reject(error);
					});
			});
		},

		async cancel(id) {
			const entry = entries.get(id);
			if (!entry) return false;
			entry.cancelled = true;
			requests.abortAll(id, "cancelled");
			await entry.session.abort();
			return true;
		},

		async update(id, patch) {
			const entry = get(id);
			if (patch.model) {
				try {
					await entry.session.setModel(patch.model);
				} catch (error) {
					throw new SessionError("auth_required", error instanceof Error ? error.message : String(error));
				}
			}
			if (patch.thinkingLevel) entry.session.setThinkingLevel(patch.thinkingLevel);
			return summarize(entry);
		},

		reply(id, requestId, reply) {
			get(id);
			return requests.reply(requestId, reply);
		},

		close,

		async closeAll() {
			for (const id of [...entries.keys()]) await close(id);
		},

		size: () => entries.size,
	};
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/sessions.test.ts`
Expected: PASS, 9 tests. Then run the whole engine folder,
`bun x vitest --run test/engine`, since `EngineEvent` changed.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/sessions.ts packages/cli/src/engine/events.ts packages/cli/test/engine/sessions.test.ts
git commit -m "feat(engine): add sessions on the engine bus"
```

---

## Task 5: Session routes and the shared route list

**Files:**
- Create: `packages/cli/src/engine/http.ts`
- Create: `packages/cli/src/engine/session-routes.ts`
- Create: `packages/cli/src/engine/routes.ts`
- Modify: `packages/cli/src/engine/completions.ts` (export `resolveModel`
  and `sendLookupError`; no other change)
- Modify: `packages/cli/src/engine-entry.ts` (build the route list through
  `engineRoutes`; close sessions on shutdown)
- Test: `packages/cli/test/engine/session-routes.test.ts`

**Interfaces:**
- Consumes: `SessionRegistry`, `SessionError` (Task 4); `EngineRoute`,
  `sendJson`; `resolveModel`, `sendLookupError`, `ModelLookupError`;
  `THINKING_LEVEL_OPTIONS` from `../core/defaults.ts`.
- Produces:
  - `http.ts`: `export class BodyError extends Error { readonly status: 400 | 413 }`,
    `export async function readJsonBody(req: IncomingMessage, maxBytes?: number): Promise<Record<string, unknown>>`
  - `session-routes.ts`: `export function sessionRoutes(ctx: EngineContext, sessions: SessionRegistry): readonly EngineRoute[]`
  - `routes.ts`: `export function engineRoutes(ctx: EngineContext, sessions: SessionRegistry): readonly EngineRoute[]`

`readJsonBody` allows 16 MB: a prompt with a few screenshots is megabytes of
base64, and the 64 KB reader in `accounts.ts` was sized for a login form.
Status mapping is fixed here and nowhere else: `not_found` 404, `busy` 409,
`auth_required` 401, `bad_request` 400, `ModelLookupError` as
`sendLookupError` already does (404 unknown, 409 ambiguous with candidates).

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/session-routes.test.ts
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@knightcode/ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext } from "../../src/engine/context.ts";
import type { EngineEvent } from "../../src/engine/events.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";
import { sessionRoutes } from "../../src/engine/session-routes.ts";
import { createSessionRegistry, type SessionRegistry, type SessionSummary } from "../../src/engine/sessions.ts";

const auth = { authorization: "Bearer t", "content-type": "application/json" };

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("session routes", () => {
	let counter = 0;
	let server: EngineServer | undefined;
	let registry: SessionRegistry | undefined;
	const dirs: string[] = [];

	afterEach(async () => {
		await registry?.closeAll();
		await server?.close();
		registry = undefined;
		server = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(options: { tokensPerSecond?: number } = {}) {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-session-routes-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-session-routes-agent-"));
		dirs.push(cwd, agentDir);
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-routes-${counter++}`, tokensPerSecond: options.tokensPerSecond });
		ctx.models.registerNativeProvider(faux.provider);
		const seen: EngineEvent[] = [];
		ctx.events.subscribe((event) => seen.push(event));
		registry = createSessionRegistry(ctx, { agentDir, sessionDir: null, defaultModel: faux.getModel() });
		server = await startEngineServer({ token: "t", routes: sessionRoutes(ctx, registry) });
		const base = `http://127.0.0.1:${server.port}`;
		const post = (path: string, body?: unknown) =>
			fetch(`${base}${path}`, { method: "POST", headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
		const create = async (): Promise<SessionSummary> => {
			const res = await post("/v1/sessions", { cwd, capabilities: { readTextFile: true, writeTextFile: true } });
			expect(res.status).toBe(201);
			return (await res.json()) as SessionSummary;
		};
		return { base, cwd, faux, seen, post, create };
	}

	test("creates, reads and deletes a session", async () => {
		const { base, create } = await start();
		const summary = await create();
		expect(summary.model?.ref).toContain("/");
		const read = await fetch(`${base}/v1/sessions/${summary.id}`, { headers: auth });
		expect(read.status).toBe(200);
		expect(await read.json()).toEqual(summary);
		const gone = await fetch(`${base}/v1/sessions/${summary.id}`, { method: "DELETE", headers: auth });
		expect(gone.status).toBe(204);
		expect((await fetch(`${base}/v1/sessions/${summary.id}`, { headers: auth })).status).toBe(404);
		expect((await fetch(`${base}/v1/sessions/${summary.id}`, { method: "DELETE", headers: auth })).status).toBe(404);
	});

	test("rejects a create without cwd", async () => {
		const { post } = await start();
		expect((await post("/v1/sessions", {})).status).toBe(400);
	});

	test("a prompt answers 202 and the turn ends on the bus", async () => {
		const { faux, seen, post, create } = await start();
		const { id } = await create();
		faux.setResponses([fauxAssistantMessage([fauxText("hi back")])]);
		const res = await post(`/v1/sessions/${id}/prompt`, { text: "hi" });
		expect(res.status).toBe(202);
		await until(() => seen.some((event) => event.type === "session.turn_end"));
		expect(seen.at(-1)).toMatchObject({ type: "session.turn_end", sessionId: id, stopReason: "end_turn" });
	});

	test("a prompt during a turn is 409 and cancel is 204", async () => {
		const { faux, seen, post, create } = await start({ tokensPerSecond: 20 });
		const { id } = await create();
		faux.setResponses([fauxAssistantMessage([fauxText("c".repeat(400))])]);
		expect((await post(`/v1/sessions/${id}/prompt`, { text: "slow" })).status).toBe(202);
		expect((await post(`/v1/sessions/${id}/prompt`, { text: "again" })).status).toBe(409);
		expect((await post(`/v1/sessions/${id}/cancel`)).status).toBe(204);
		await until(() => seen.some((event) => event.type === "session.turn_end"));
		expect(seen.at(-1)).toMatchObject({ type: "session.turn_end", stopReason: "cancelled" });
		expect((await post("/v1/sessions/nope/cancel")).status).toBe(404);
	});

	test("answers a client request and refuses an unknown one", async () => {
		const { faux, seen, post, create } = await start();
		const { id } = await create();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "x" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await post(`/v1/sessions/${id}/prompt`, { text: "write" });
		await until(() => seen.some((event) => event.type === "session.request"));
		const request = seen.find((event) => event.type === "session.request");
		if (request?.type !== "session.request") throw new Error("no request");
		expect((await post(`/v1/sessions/${id}/requests/nope`, { kind: "permission", outcome: "allow_once" })).status).toBe(404);
		expect((await post(`/v1/sessions/${id}/requests/${request.requestId}`, { kind: "nonsense" })).status).toBe(400);
		expect(
			(await post(`/v1/sessions/${id}/requests/${request.requestId}`, { kind: "permission", outcome: "reject_once" })).status,
		).toBe(204);
		await until(() => seen.some((event) => event.type === "session.turn_end"));
	});

	test("patches model and thinking level, and refuses nonsense", async () => {
		const { base, faux, create } = await start();
		const { id, thinkingLevels } = await create();
		const patch = (body: unknown) =>
			fetch(`${base}/v1/sessions/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
		const level = thinkingLevels.find((candidate) => candidate !== "medium") ?? "off";
		const ok = await patch({ thinkingLevel: level, model: `${faux.provider.id}/${faux.getModel().id}` });
		expect(ok.status).toBe(200);
		expect(((await ok.json()) as SessionSummary).thinkingLevel).toBe(level);
		expect((await patch({ thinkingLevel: "galactic" })).status).toBe(400);
		expect((await patch({ model: "no-such-model" })).status).toBe(404);
	});

	test("no response body carries a credential", async () => {
		const { base, create } = await start();
		const { id } = await create();
		const raw = await (await fetch(`${base}/v1/sessions/${id}`, { headers: auth })).text();
		expect(raw).not.toMatch(/sk-|api_key|refresh/);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/session-routes.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/session-routes.ts`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/http.ts
import type { IncomingMessage } from "node:http";

export class BodyError extends Error {
	readonly status: 400 | 413;

	constructor(status: 400 | 413, message: string) {
		super(message);
		this.status = status;
	}
}

/** A prompt carrying screenshots is megabytes of base64; the login reader's 64 KB would refuse it. */
const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function readJsonBody(req: IncomingMessage, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > maxBytes) throw new BodyError(413, "body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	} catch {
		throw new BodyError(400, "body is not JSON");
	}
	return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}
```

In `completions.ts`, prefix `function resolveModel` and
`function sendLookupError` with `export`. Nothing else changes.

```ts
// packages/cli/src/engine/session-routes.ts
/**
 * Session routes.
 *
 * A session is created, prompted, cancelled, reconfigured and closed here.
 * The turn itself is not a response: `prompt` answers 202 once preflight has
 * passed and the outcome arrives on /events as `session.turn_end`. Questions
 * the engine has for the client arrive there too, as `session.request`, and
 * are answered through the `requests` route.
 */

import type { ServerResponse } from "node:http";
import type { ThinkingLevel } from "@knightcode/agent";
import type { ImageContent } from "@knightcode/ai";
import { THINKING_LEVEL_OPTIONS } from "../core/defaults.ts";
import type { ClientFileCapabilities } from "./client-fs.ts";
import type { ClientReply, PermissionOutcome } from "./client-requests.ts";
import { ModelLookupError, resolveModel, sendLookupError } from "./completions.ts";
import type { EngineContext } from "./context.ts";
import { BodyError, readJsonBody } from "./http.ts";
import { type EngineRoute, sendJson } from "./server.ts";
import { SessionError, type SessionRegistry } from "./sessions.ts";

const PREFIX = "/v1/sessions/";
const PERMISSION_OUTCOMES: ReadonlySet<string> = new Set([
	"allow_once",
	"allow_always",
	"reject_once",
	"reject_always",
	"cancelled",
]);

function statusOf(error: SessionError): number {
	switch (error.code) {
		case "not_found":
			return 404;
		case "busy":
			return 409;
		case "auth_required":
			return 401;
		default:
			return 400;
	}
}

function sendError(res: ServerResponse, error: unknown): void {
	if (error instanceof SessionError) {
		sendJson(res, statusOf(error), { error: error.code, message: error.message });
	} else if (error instanceof ModelLookupError) {
		sendLookupError(res, error);
	} else if (error instanceof BodyError) {
		sendJson(res, error.status, { error: "bad_request", message: error.message });
	} else {
		sendJson(res, 500, { error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && (THINKING_LEVEL_OPTIONS as readonly string[]).includes(value)) {
		return value as ThinkingLevel;
	}
	throw new SessionError("bad_request", `unknown thinking level: ${String(value)}`);
}

function parseImages(value: unknown): ImageContent[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new SessionError("bad_request", "images must be an array");
	return value.map((entry: unknown) => {
		const image = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
		if (typeof image.data !== "string" || typeof image.mimeType !== "string") {
			throw new SessionError("bad_request", "an image needs data and mimeType");
		}
		return { type: "image", data: image.data, mimeType: image.mimeType };
	});
}

function parseCapabilities(value: unknown): Partial<ClientFileCapabilities> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	return { readTextFile: record.readTextFile === true, writeTextFile: record.writeTextFile === true };
}

function parseReply(body: Record<string, unknown>): ClientReply {
	switch (body.kind) {
		case "permission":
			if (typeof body.outcome === "string" && PERMISSION_OUTCOMES.has(body.outcome)) {
				return { kind: "permission", outcome: body.outcome as PermissionOutcome };
			}
			break;
		case "fs.read":
			if (typeof body.content === "string") return { kind: "fs.read", content: body.content };
			break;
		case "fs.write":
			return { kind: "fs.write" };
		case "error":
			if (body.code === "not_found" || body.code === "failed") {
				return { kind: "error", code: body.code, message: typeof body.message === "string" ? body.message : "" };
			}
			break;
		default:
			break;
	}
	throw new SessionError("bad_request", "malformed reply");
}

export function sessionRoutes(ctx: EngineContext, sessions: SessionRegistry): readonly EngineRoute[] {
	const segments = (url: URL): string[] => url.pathname.slice(PREFIX.length).split("/").map(decodeURIComponent);

	return [
		{
			method: "POST",
			path: "/v1/sessions",
			handle: async (req, res) => {
				try {
					const body = await readJsonBody(req);
					if (typeof body.cwd !== "string" || body.cwd.length === 0) {
						throw new SessionError("bad_request", "cwd is required");
					}
					const model = typeof body.model === "string" ? resolveModel(ctx, body.model) : undefined;
					const summary = await sessions.create({ cwd: body.cwd, model, capabilities: parseCapabilities(body.capabilities) });
					sendJson(res, 201, summary);
				} catch (error) {
					sendError(res, error);
				}
			},
		},
		{
			method: "GET",
			path: "/v1/sessions",
			prefix: true,
			handle: (_req, res, url) => {
				const summary = sessions.summary(segments(url)[0]);
				if (summary) sendJson(res, 200, summary);
				else sendJson(res, 404, { error: "not_found" });
			},
		},
		{
			method: "PATCH",
			path: "/v1/sessions",
			prefix: true,
			handle: async (req, res, url) => {
				try {
					const body = await readJsonBody(req);
					const model = typeof body.model === "string" ? resolveModel(ctx, body.model) : undefined;
					sendJson(res, 200, await sessions.update(segments(url)[0], { model, thinkingLevel: parseThinkingLevel(body.thinkingLevel) }));
				} catch (error) {
					sendError(res, error);
				}
			},
		},
		{
			method: "DELETE",
			path: "/v1/sessions",
			prefix: true,
			handle: async (_req, res, url) => {
				if (await sessions.close(segments(url)[0])) {
					res.writeHead(204);
					res.end();
				} else {
					sendJson(res, 404, { error: "not_found" });
				}
			},
		},
		{
			method: "POST",
			path: "/v1/sessions",
			prefix: true,
			handle: async (req, res, url) => {
				const [id, action, requestId] = segments(url);
				try {
					if (action === "prompt") {
						const body = await readJsonBody(req);
						await sessions.prompt(id, {
							text: typeof body.text === "string" ? body.text : "",
							images: parseImages(body.images),
						});
						sendJson(res, 202, { accepted: true });
						return;
					}
					if (action === "cancel") {
						if (!(await sessions.cancel(id))) throw new SessionError("not_found", `unknown session: ${id}`);
						res.writeHead(204);
						res.end();
						return;
					}
					if (action === "requests" && requestId) {
						const reply = parseReply(await readJsonBody(req));
						if (!sessions.reply(id, requestId, reply)) {
							sendJson(res, 404, { error: "unknown_request" });
							return;
						}
						res.writeHead(204);
						res.end();
						return;
					}
					sendJson(res, 404, { error: "not_found" });
				} catch (error) {
					sendError(res, error);
				}
			},
		},
	];
}
```

```ts
// packages/cli/src/engine/routes.ts
import { accountsRoutes } from "./accounts.ts";
import { completionsRoutes } from "./completions.ts";
import type { EngineContext } from "./context.ts";
import { eventsRoute } from "./events.ts";
import { modelsRoute } from "./models.ts";
import type { EngineRoute } from "./server.ts";
import { sessionRoutes } from "./session-routes.ts";
import type { SessionRegistry } from "./sessions.ts";

/**
 * Every route the engine serves. Both entrypoints build the list here, so an
 * adapter attached to the standalone engine and one that booted its own see
 * the same server.
 */
export function engineRoutes(ctx: EngineContext, sessions: SessionRegistry): readonly EngineRoute[] {
	return [
		eventsRoute(ctx.events),
		modelsRoute(ctx),
		...accountsRoutes(ctx),
		...completionsRoutes(ctx),
		...sessionRoutes(ctx, sessions),
	];
}
```

In `engine-entry.ts`, replace the five route imports and the inline list:

```ts
import { createEngineContext } from "./engine/context.ts";
import { engineRoutes } from "./engine/routes.ts";
import { startEngineServer } from "./engine/server.ts";
import { createSessionRegistry } from "./engine/sessions.ts";
// ...
const ctx = await createEngineContext({ allowModelNetwork: true });
const sessions = createSessionRegistry(ctx);
const server = await startEngineServer({ token, routes: engineRoutes(ctx, sessions) });
// ...
const shutdown = () => {
	if (closing) return;
	closing = true;
	void sessions
		.closeAll()
		.then(() => server.close())
		.finally(() => process.exit(0));
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/session-routes.test.ts`
Expected: PASS, 7 tests. Run `test/engine` as a whole afterwards; the
completions exports and the entry refactor touch nothing else, and this is
the check that proves it.

- [x] **Step 5: Verify the standalone engine by hand**

```bash
KNIGHTCODE_ENGINE_TOKEN=$(openssl rand -hex 32) bun run packages/cli/src/engine-entry.ts
```

Then, with `PORT` and `TOKEN` from the printed line and the environment:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"cwd\":\"$PWD\"}" http://127.0.0.1:$PORT/v1/sessions
```

Expected: `201` with a summary whose `model.ref` is the CLI's default model,
or `401 auth_required` on a machine with no credential. Do not send a
prompt: that spends tokens, and Task 9 proves prompting against the faux
provider.

- [x] **Step 6: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/http.ts packages/cli/src/engine/session-routes.ts packages/cli/src/engine/routes.ts packages/cli/src/engine/completions.ts packages/cli/src/engine-entry.ts packages/cli/test/engine/session-routes.test.ts
git commit -m "feat(engine): add /v1/sessions routes"
```

---

## Task 6: The protocol SDK and the engine client

**Files:**
- Modify: `packages/cli/package.json` (two devDependencies), `bun.lock`
- Create: `packages/cli/src/engine/acp/engine-client.ts`
- Test: `packages/cli/test/engine/acp/engine-client.test.ts`

**Interfaces:**
- Consumes: the session routes (Task 5) over HTTP; `EngineEvent`,
  `EngineModel`, `SessionSummary`, `PromptInput`, `ClientReply`,
  `ClientFileCapabilities` as types.
- Produces:
  - `export class EngineRequestError extends Error { readonly status: number; readonly code: string }`
  - `export interface EngineClientOptions { baseUrl: string; token: string; reconnectDelayMs?: number }`
  - `export interface CreateSessionBody { cwd: string; model?: string; capabilities?: Partial<ClientFileCapabilities> }`
  - `export interface UpdateSessionBody { model?: string; thinkingLevel?: string }`
  - `export interface EventHandlers { onEvent(event: EngineEvent): Promise<void>; onDisconnect?(): void }`
  - `export interface EngineClient { models(): Promise<EngineModel[]>; createSession(body): Promise<SessionSummary>; getSession(id): Promise<SessionSummary>; updateSession(id, body): Promise<SessionSummary>; prompt(id, input: PromptInput): Promise<void>; cancel(id): Promise<void>; reply(id, requestId, reply: ClientReply): Promise<void>; closeSession(id): Promise<void>; events(handlers: EventHandlers, signal: AbortSignal): Promise<void> }`
  - `export function createEngineClient(options: EngineClientOptions): EngineClient`

The dependency is `@agentclientprotocol/sdk` at exactly `1.4.0` (published
2026-08-20, clear of `min-release-age`), which peer-depends on `zod` and
imports `zod/v4` at runtime; `zod` 4.4.3 is already in `bun.lock` as a
transitive dependency, so pin it as a direct one at that version rather than
letting the hoisted copy be an accident. The SDK ships no lifecycle scripts
(`package.json` `scripts`: `clean`, `test`, `generate`). Both go under
`devDependencies` in `packages/cli/package.json`, where every runtime
dependency of the compiled binary already lives.

- [x] **Step 1: Add the dependency**

```bash
cd packages/cli && bun add -d @agentclientprotocol/sdk@1.4.0 zod@4.4.3
```

Confirm the `bun.lock` diff adds exactly those two direct entries and no
new transitive package. `bun x prettier --check packages/cli/package.json`
is not run — `.prettierignore` does not cover it, but `bun add` writes it
in the repository's existing style; eyeball the diff.

- [x] **Step 2: Write the failing test**

```ts
// packages/cli/test/engine/acp/engine-client.test.ts
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxProvider } from "@knightcode/ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineClient, EngineRequestError } from "../../../src/engine/acp/engine-client.ts";
import { createEngineContext } from "../../../src/engine/context.ts";
import { createEventBus, type EngineEvent, eventsRoute } from "../../../src/engine/events.ts";
import { modelsRoute } from "../../../src/engine/models.ts";
import { type EngineRoute, type EngineServer, startEngineServer } from "../../../src/engine/server.ts";
import { sessionRoutes } from "../../../src/engine/session-routes.ts";
import { createSessionRegistry, type SessionRegistry } from "../../../src/engine/sessions.ts";

describe("engine client", () => {
	let counter = 0;
	let server: EngineServer | undefined;
	let registry: SessionRegistry | undefined;
	const dirs: string[] = [];

	afterEach(async () => {
		await registry?.closeAll();
		await server?.close();
		registry = undefined;
		server = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(extraRoutes: readonly EngineRoute[] = []) {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-engine-client-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-engine-client-agent-"));
		dirs.push(cwd, agentDir);
		const events = createEventBus();
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null, events });
		const faux = fauxProvider({ provider: `faux-engine-client-${counter++}` });
		ctx.models.registerNativeProvider(faux.provider);
		registry = createSessionRegistry(ctx, { agentDir, sessionDir: null, defaultModel: faux.getModel() });
		server = await startEngineServer({
			token: "t",
			routes: [...extraRoutes, eventsRoute(events, 50), modelsRoute(ctx), ...sessionRoutes(ctx, registry)],
		});
		const client = createEngineClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "t", reconnectDelayMs: 10 });
		return { client, cwd, faux, events };
	}

	test("round-trips a session and lists models", async () => {
		const { client, cwd, faux } = await start();
		const created = await client.createSession({ cwd, capabilities: { readTextFile: true, writeTextFile: true } });
		expect(created.model?.ref).toBe(`${faux.provider.id}/${faux.getModel().id}`);
		expect(await client.getSession(created.id)).toEqual(created);
		const level = created.thinkingLevels.find((candidate) => candidate !== created.thinkingLevel) ?? "off";
		expect((await client.updateSession(created.id, { thinkingLevel: level })).thinkingLevel).toBe(level);
		expect((await client.models()).some((model) => model.ref === created.model?.ref)).toBe(true);
		await client.closeSession(created.id);
		await expect(client.getSession(created.id)).rejects.toMatchObject({ status: 404, code: "not_found" });
	});

	test("an engine error carries its status and code", async () => {
		const { client } = await start();
		const error = await client.createSession({ cwd: "" }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(EngineRequestError);
		expect(error).toMatchObject({ status: 400, code: "bad_request" });
	});

	test("delivers events in order and reconnects after a drop", async () => {
		// A stream that ends after its first event, so the client must come back for the second.
		let connections = 0;
		const bus = createEventBus();
		const flaky: EngineRoute = {
			method: "GET",
			path: "/events",
			handle: (_req, res) => {
				connections += 1;
				res.writeHead(200, { "content-type": "text/event-stream" });
				const unsubscribe = bus.subscribe((event) => {
					res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
					if (connections === 1) res.end();
				});
				res.on("close", unsubscribe);
			},
		};
		const { client } = await start([flaky]);
		const seen: EngineEvent[] = [];
		let drops = 0;
		const controller = new AbortController();
		const loop = client.events(
			{
				onEvent: async (event) => {
					seen.push(event);
				},
				onDisconnect: () => {
					drops += 1;
				},
			},
			controller.signal,
		);

		await waitFor(() => connections === 1);
		bus.publish({ type: "models.changed" });
		await waitFor(() => drops === 1 && connections === 2);
		bus.publish({ type: "account.changed", providerId: "p", authenticated: true });
		await waitFor(() => seen.length === 2);
		expect(seen.map((event) => event.type)).toEqual(["models.changed", "account.changed"]);

		controller.abort();
		await loop;
	});
});

async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
```

The flaky route is registered before the real `/events` because the router
returns the first exact match (`server.ts` 96–104).

- [x] **Step 3: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/engine-client.test.ts`
Expected: FAIL — cannot resolve `../../../src/engine/acp/engine-client.ts`.

- [x] **Step 4: Write minimal implementation**

```ts
// packages/cli/src/engine/acp/engine-client.ts
/**
 * The engine as the adapter sees it.
 *
 * The adapter is a client and nothing more: it holds no model, no credential
 * and no transcript. Everything it knows arrives through these calls and the
 * event stream. `events()` reconnects until its signal aborts; a drop fails
 * every turn in flight, because its `turn_end` may have been on the wire.
 */

import type { ClientFileCapabilities } from "../client-fs.ts";
import type { ClientReply } from "../client-requests.ts";
import type { EngineEvent } from "../events.ts";
import type { EngineModel } from "../models.ts";
import type { PromptInput, SessionSummary } from "../sessions.ts";

export class EngineRequestError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

export interface EngineClientOptions {
	baseUrl: string;
	token: string;
	reconnectDelayMs?: number;
}

export interface CreateSessionBody {
	cwd: string;
	model?: string;
	capabilities?: Partial<ClientFileCapabilities>;
}

export interface UpdateSessionBody {
	model?: string;
	thinkingLevel?: string;
}

export interface EventHandlers {
	onEvent(event: EngineEvent): Promise<void>;
	onDisconnect?(): void;
}

export interface EngineClient {
	models(): Promise<EngineModel[]>;
	createSession(body: CreateSessionBody): Promise<SessionSummary>;
	getSession(id: string): Promise<SessionSummary>;
	updateSession(id: string, body: UpdateSessionBody): Promise<SessionSummary>;
	prompt(id: string, input: PromptInput): Promise<void>;
	cancel(id: string): Promise<void>;
	reply(id: string, requestId: string, reply: ClientReply): Promise<void>;
	closeSession(id: string): Promise<void>;
	/** Consume /events until `signal` aborts, reconnecting after a drop. Events are handled one at a time, in order. */
	events(handlers: EventHandlers, signal: AbortSignal): Promise<void>;
}

async function consume(body: ReadableStream<Uint8Array>, onEvent: (event: EngineEvent) => Promise<void>): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let boundary = buffer.indexOf("\n\n");
		while (boundary >= 0) {
			const block = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			// Comments (heartbeats) have no data line and are skipped.
			const data = block
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice("data:".length).trim())
				.join("\n");
			if (data.length > 0) await onEvent(JSON.parse(data) as EngineEvent);
			boundary = buffer.indexOf("\n\n");
		}
	}
}

export function createEngineClient(options: EngineClientOptions): EngineClient {
	const headers = { authorization: `Bearer ${options.token}` };
	const reconnectDelayMs = options.reconnectDelayMs ?? 1000;

	async function call(method: string, path: string, body?: unknown): Promise<unknown> {
		const res = await fetch(`${options.baseUrl}${path}`, {
			method,
			headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		const parsed: unknown = text.length > 0 ? JSON.parse(text) : undefined;
		if (!res.ok) {
			const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
			throw new EngineRequestError(
				res.status,
				typeof record.error === "string" ? record.error : "error",
				typeof record.message === "string" ? record.message : `${method} ${path} failed with ${res.status}`,
			);
		}
		return parsed;
	}

	const session = (id: string) => `/v1/sessions/${encodeURIComponent(id)}`;

	return {
		models: async () => ((await call("GET", "/v1/models")) as { models: EngineModel[] }).models,
		createSession: (body) => call("POST", "/v1/sessions", body) as Promise<SessionSummary>,
		getSession: (id) => call("GET", session(id)) as Promise<SessionSummary>,
		updateSession: (id, body) => call("PATCH", session(id), body) as Promise<SessionSummary>,
		prompt: async (id, input) => {
			await call("POST", `${session(id)}/prompt`, input);
		},
		cancel: async (id) => {
			await call("POST", `${session(id)}/cancel`);
		},
		reply: async (id, requestId, reply) => {
			await call("POST", `${session(id)}/requests/${encodeURIComponent(requestId)}`, reply);
		},
		closeSession: async (id) => {
			await call("DELETE", session(id));
		},
		async events(handlers, signal) {
			while (!signal.aborted) {
				try {
					const res = await fetch(`${options.baseUrl}/events`, { headers, signal });
					if (!res.ok || !res.body) throw new EngineRequestError(res.status, "events", "event stream refused");
					await consume(res.body, handlers.onEvent);
				} catch {
					// A refused or dropped stream is retried below; an abort ends the loop.
				}
				if (signal.aborted) return;
				handlers.onDisconnect?.();
				await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
			}
		},
	};
}
```

Under Node, `fetch` is undici with a 300 s body timeout between chunks; the
engine's 15 s heartbeat keeps the stream inside it. Under Bun there is no
such timeout. Neither needs configuring.

- [x] **Step 5: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/engine-client.test.ts`
Expected: PASS, 3 tests.

- [x] **Step 6: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/package.json bun.lock packages/cli/src/engine/acp/engine-client.ts packages/cli/test/engine/acp/engine-client.test.ts
git commit -m "feat(engine): add the ACP SDK and an HTTP client for the engine"
```

---

## Task 7: Prompt content and tool presentation

**Files:**
- Create: `packages/cli/src/engine/acp/content.ts`
- Create: `packages/cli/src/engine/acp/tools.ts`
- Test: `packages/cli/test/engine/acp/content.test.ts`,
  `packages/cli/test/engine/acp/tools.test.ts`

**Interfaces:**
- Consumes: `ContentBlock`, `ToolCallContent`, `ToolCallLocation`,
  `ToolKind` from `@agentclientprotocol/sdk`; `PromptInput`; `ToolContent`.
- Produces:
  - `content.ts`: `export function toPromptInput(blocks: readonly ContentBlock[]): PromptInput`
  - `tools.ts`: `export function toolKind(name: string): ToolKind`,
    `export function toolTitle(name: string, args: unknown, cwd: string): string`,
    `export function toolLocations(name: string, args: unknown, cwd: string): ToolCallLocation[]`,
    `export function toolResultContent(content: readonly ToolContent[]): ToolCallContent[]`

Both modules are pure. Embedded resources become a labelled block, the way
OpenCode does it (`content.ts` 75–95), so the model knows where the text
came from; a resource link becomes the path alone, which the read tool can
follow. Titles are what Zed renders as the card label; `execute` titles are
plain text, the rest markdown (`acp_thread.rs` 892–899).

- [x] **Step 1: Write the failing tests**

```ts
// packages/cli/test/engine/acp/content.test.ts
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { toPromptInput } from "../../../src/engine/acp/content.ts";

describe("prompt content", () => {
	test("joins text blocks and collects images", () => {
		const input = toPromptInput([
			{ type: "text", text: "look at this" },
			{ type: "image", data: "aGk=", mimeType: "image/png" },
			{ type: "text", text: "and that" },
		]);
		expect(input.text).toBe("look at this\nand that");
		expect(input.images).toEqual([{ type: "image", data: "aGk=", mimeType: "image/png" }]);
	});

	test("labels an embedded text resource with its path", () => {
		const path = process.platform === "win32" ? "C:\\proj\\a.ts" : "/proj/a.ts";
		const input = toPromptInput([
			{ type: "text", text: "fix" },
			{ type: "resource", resource: { uri: pathToFileURL(path).href, text: "const a = 1;", mimeType: "text/plain" } },
		]);
		expect(input.text).toBe(`fix\n[${path}]\nconst a = 1;`);
		expect(input.images).toBeUndefined();
	});

	test("turns a resource link into its path and keeps other URIs verbatim", () => {
		const path = process.platform === "win32" ? "C:\\proj\\b.ts" : "/proj/b.ts";
		const input = toPromptInput([
			{ type: "resource_link", uri: pathToFileURL(path).href, name: "b.ts" },
			{ type: "resource_link", uri: "https://example.com/doc", name: "doc" },
		]);
		expect(input.text).toBe(`${path}\nhttps://example.com/doc`);
	});

	test("drops audio and blob resources", () => {
		const input = toPromptInput([
			{ type: "audio", data: "AAAA", mimeType: "audio/wav" },
			{ type: "resource", resource: { uri: "file:///x.bin", blob: "AAAA", mimeType: "application/octet-stream" } },
			{ type: "text", text: "only this" },
		]);
		expect(input.text).toBe("only this");
	});
});
```

```ts
// packages/cli/test/engine/acp/tools.test.ts
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { toolKind, toolLocations, toolResultContent, toolTitle } from "../../../src/engine/acp/tools.ts";

const cwd = resolve(process.platform === "win32" ? "C:\\proj" : "/proj");

describe("tool presentation", () => {
	test("maps built-in tools to kinds", () => {
		expect(["read", "edit", "write", "bash", "powershell", "grep", "find", "ls", "custom"].map(toolKind)).toEqual([
			"read",
			"edit",
			"edit",
			"execute",
			"execute",
			"search",
			"search",
			"search",
			"other",
		]);
	});

	test("titles name the file relative to cwd, the command, or the pattern", () => {
		expect(toolTitle("read", { path: "src/a.ts" }, cwd)).toBe(`Read ${join("src", "a.ts")}`);
		expect(toolTitle("edit", { path: join(cwd, "b.ts") }, cwd)).toBe("Edit b.ts");
		expect(toolTitle("write", { path: resolve(cwd, "..", "outside.txt") }, cwd)).toBe(
			`Write ${resolve(cwd, "..", "outside.txt")}`,
		);
		expect(toolTitle("bash", { command: "ls -la" }, cwd)).toBe("ls -la");
		expect(toolTitle("grep", { pattern: "TODO" }, cwd)).toBe("grep TODO");
		expect(toolTitle("custom", { anything: 1 }, cwd)).toBe("custom");
	});

	test("locations are absolute and only for file tools", () => {
		expect(toolLocations("read", { path: "src/a.ts" }, cwd)).toEqual([{ path: join(cwd, "src", "a.ts") }]);
		expect(toolLocations("grep", { pattern: "x", path: "src" }, cwd)).toEqual([{ path: join(cwd, "src") }]);
		expect(toolLocations("grep", { pattern: "x" }, cwd)).toEqual([]);
		expect(toolLocations("bash", { command: "ls" }, cwd)).toEqual([]);
	});

	test("result content passes text and images through", () => {
		expect(
			toolResultContent([
				{ type: "text", text: "out" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			]),
		).toEqual([
			{ type: "content", content: { type: "text", text: "out" } },
			{ type: "content", content: { type: "image", data: "AAAA", mimeType: "image/png" } },
		]);
	});
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/content.test.ts test/engine/acp/tools.test.ts`
Expected: FAIL — cannot resolve the two modules.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/acp/content.ts
/**
 * ACP prompt blocks to the text-plus-images shape `AgentSession.prompt`
 * takes. Pure.
 */

import { fileURLToPath } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ImageContent } from "@knightcode/ai";
import type { PromptInput } from "../sessions.ts";

/** A file: URI becomes a path the read tool can follow; anything else stays a URI. */
function uriToPath(uri: string): string {
	try {
		const url = new URL(uri);
		if (url.protocol === "file:") return fileURLToPath(url);
	} catch {
		// Not a URL at all; hand it to the model as written.
	}
	return uri;
}

export function toPromptInput(blocks: readonly ContentBlock[]): PromptInput {
	const parts: string[] = [];
	const images: ImageContent[] = [];
	for (const block of blocks) {
		switch (block.type) {
			case "text":
				parts.push(block.text);
				break;
			case "image":
				images.push({ type: "image", data: block.data, mimeType: block.mimeType });
				break;
			case "resource_link":
				parts.push(uriToPath(block.uri));
				break;
			case "resource":
				// Labelled so the model knows what it is looking at; a blob has no text to show.
				if ("text" in block.resource) parts.push(`[${uriToPath(block.resource.uri)}]\n${block.resource.text}`);
				break;
			default:
				// Audio has nowhere to go.
				break;
		}
	}
	return { text: parts.join("\n"), ...(images.length > 0 ? { images } : {}) };
}
```

```ts
// packages/cli/src/engine/acp/tools.ts
/**
 * How a tool call looks in the editor: its kind, its title, the files it
 * touches, and its output as content. Pure.
 */

import { isAbsolute, relative, resolve } from "node:path";
import type { ToolCallContent, ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk";
import type { ToolContent } from "../events.ts";

export function toolKind(name: string): ToolKind {
	switch (name) {
		case "read":
			return "read";
		case "edit":
		case "write":
			return "edit";
		case "bash":
		case "powershell":
			return "execute";
		case "grep":
		case "find":
		case "ls":
			return "search";
		default:
			return "other";
	}
}

function stringArg(args: unknown, key: string): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function absolutePath(path: string, cwd: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

/** Relative to cwd when inside it, absolute otherwise. */
function displayPath(path: string, cwd: string): string {
	const absolute = absolutePath(path, cwd);
	const rel = relative(cwd, absolute);
	return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel) ? rel : absolute;
}

export function toolTitle(name: string, args: unknown, cwd: string): string {
	const path = stringArg(args, "path");
	switch (name) {
		case "read":
			return path ? `Read ${displayPath(path, cwd)}` : "Read";
		case "edit":
			return path ? `Edit ${displayPath(path, cwd)}` : "Edit";
		case "write":
			return path ? `Write ${displayPath(path, cwd)}` : "Write";
		case "bash":
		case "powershell":
			return stringArg(args, "command") ?? name;
		case "grep":
		case "find": {
			const pattern = stringArg(args, "pattern");
			return pattern ? `${name} ${pattern}` : name;
		}
		case "ls":
			return path ? `ls ${displayPath(path, cwd)}` : "ls";
		default:
			return name;
	}
}

export function toolLocations(name: string, args: unknown, cwd: string): ToolCallLocation[] {
	const path = stringArg(args, "path");
	switch (name) {
		case "read":
		case "edit":
		case "write":
		case "grep":
		case "find":
		case "ls":
			return path ? [{ path: absolutePath(path, cwd) }] : [];
		default:
			return [];
	}
}

export function toolResultContent(content: readonly ToolContent[]): ToolCallContent[] {
	return content.map((block) =>
		block.type === "text"
			? { type: "content", content: { type: "text", text: block.text } }
			: { type: "content", content: { type: "image", data: block.data, mimeType: block.mimeType } },
	);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/content.test.ts test/engine/acp/tools.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/acp/content.ts packages/cli/src/engine/acp/tools.ts packages/cli/test/engine/acp/content.test.ts packages/cli/test/engine/acp/tools.test.ts
git commit -m "feat(engine): map ACP prompt content and tool presentation"
```

---

## Task 8: Session events to session updates

**Files:**
- Create: `packages/cli/src/engine/acp/updates.ts`
- Test: `packages/cli/test/engine/acp/updates.test.ts`

**Interfaces:**
- Consumes: `SessionEvent`; `SessionUpdate`, `ToolCallContent` from the SDK;
  Task 7.
- Produces:
  - `export interface SessionState { cwd: string; announced: Set<string>; rejected: Set<string>; diffed: Set<string>; terminals: Map<string, { id: string; output: string }> }`
  - `export function createSessionState(cwd: string): SessionState`
  - `export function toSessionUpdates(event: SessionEvent, state: SessionState): SessionUpdate[]`

Pure, given the state. The state records which tool calls the client has
been told about (`announced`), which the user rejected (`rejected`: their
end must not overwrite Zed's Rejected status), which already carry a diff
(`diffed`: their end must not replace the diff with output text —
`content` replaces the collection), and the display-only terminal of each
shell call (§1.6).

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/acp/updates.test.ts
import { describe, expect, test } from "vitest";
import { createSessionState, toSessionUpdates } from "../../../src/engine/acp/updates.ts";
import type { SessionEvent } from "../../../src/engine/events.ts";

const cwd = process.platform === "win32" ? "C:\\proj" : "/proj";
const sessionId = "s1";

function meta(update: { _meta?: { [key: string]: unknown } | null }): Record<string, unknown> {
	return (update._meta ?? {}) as Record<string, unknown>;
}

describe("session updates", () => {
	test("text and thinking deltas become message and thought chunks", () => {
		const state = createSessionState(cwd);
		const text: SessionEvent = { type: "session.delta", sessionId, messageId: "m1", kind: "text", delta: "hi" };
		const thought: SessionEvent = { type: "session.delta", sessionId, messageId: "m1", kind: "thinking", delta: "hm" };
		expect(toSessionUpdates(text, state)).toEqual([
			{ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "hi" } },
		]);
		expect(toSessionUpdates(thought, state)).toEqual([
			{ sessionUpdate: "agent_thought_chunk", messageId: "m1", content: { type: "text", text: "hm" } },
		]);
	});

	test("a tool call is announced once, then progressed, then completed with its output", () => {
		const state = createSessionState(cwd);
		const args = { path: "a.txt" };
		const [announced] = toSessionUpdates(
			{ type: "session.tool_call", sessionId, toolCallId: "t1", toolName: "read", args },
			state,
		);
		expect(announced).toMatchObject({
			sessionUpdate: "tool_call",
			toolCallId: "t1",
			title: "Read a.txt",
			kind: "read",
			status: "pending",
			rawInput: args,
			_meta: { tool_name: "read" },
		});
		expect(toSessionUpdates({ type: "session.tool_start", sessionId, toolCallId: "t1", toolName: "read", args }, state)).toEqual(
			[{ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" }],
		);
		const [ended] = toSessionUpdates(
			{
				type: "session.tool_end",
				sessionId,
				toolCallId: "t1",
				toolName: "read",
				args,
				content: [{ type: "text", text: "the file" }],
				details: { lineCount: 1 },
				isError: false,
			},
			state,
		);
		expect(ended).toMatchObject({
			sessionUpdate: "tool_call_update",
			toolCallId: "t1",
			status: "completed",
			content: [{ type: "content", content: { type: "text", text: "the file" } }],
			rawOutput: { content: "the file", details: { lineCount: 1 } },
		});
		expect(state.announced.has("t1")).toBe(false);
	});

	test("a start for an unannounced call announces it as in progress", () => {
		const state = createSessionState(cwd);
		const [update] = toSessionUpdates(
			{ type: "session.tool_start", sessionId, toolCallId: "t2", toolName: "grep", args: { pattern: "x" } },
			state,
		);
		expect(update).toMatchObject({ sessionUpdate: "tool_call", toolCallId: "t2", status: "in_progress", kind: "search" });
	});

	test("a failed call is failed, a rejected call keeps its status, a diffed call keeps its diff", () => {
		const state = createSessionState(cwd);
		const end = (toolCallId: string, toolName: string): SessionEvent => ({
			type: "session.tool_end",
			sessionId,
			toolCallId,
			toolName,
			args: {},
			content: [{ type: "text", text: "nope" }],
			details: undefined,
			isError: true,
		});
		expect(toSessionUpdates(end("t3", "bash"), state)[0]).toMatchObject({ status: "failed" });

		state.rejected.add("t4");
		const [rejected] = toSessionUpdates(end("t4", "write"), state);
		expect(rejected).toEqual({ sessionUpdate: "tool_call_update", toolCallId: "t4", rawOutput: { content: "nope" } });
		expect(state.rejected.has("t4")).toBe(false);

		state.diffed.add("t5");
		const [diffed] = toSessionUpdates({ ...end("t5", "edit"), isError: false }, state);
		expect(diffed).toEqual({
			sessionUpdate: "tool_call_update",
			toolCallId: "t5",
			status: "completed",
			rawOutput: { content: "nope" },
		});
		expect(state.diffed.has("t5")).toBe(false);
	});

	test("a shell call gets a display-only terminal fed by output deltas and closed with its exit code", () => {
		const state = createSessionState(cwd);
		const args = { command: "npm test" };
		const [announced] = toSessionUpdates(
			{ type: "session.tool_call", sessionId, toolCallId: "t6", toolName: "bash", args },
			state,
		);
		const info = meta(announced).terminal_info as { terminal_id: string; cwd: string };
		expect(info.cwd).toBe(cwd);
		expect(announced).toMatchObject({
			title: "npm test",
			kind: "execute",
			content: [{ type: "terminal", terminalId: info.terminal_id }],
		});

		const update = (text: string): SessionEvent => ({
			type: "session.tool_update",
			sessionId,
			toolCallId: "t6",
			toolName: "bash",
			content: [{ type: "text", text }],
			details: undefined,
		});
		expect(meta(toSessionUpdates(update("one\n"), state)[0]).terminal_output).toEqual({
			terminal_id: info.terminal_id,
			data: "one\n",
		});
		expect(toSessionUpdates(update("one\n"), state)).toEqual([]);
		expect(meta(toSessionUpdates(update("one\ntwo\n"), state)[0]).terminal_output).toEqual({
			terminal_id: info.terminal_id,
			data: "two\n",
		});
		// Tail truncation moved the window: clear and repaint.
		expect((meta(toSessionUpdates(update("two\nthree\n"), state)[0]).terminal_output as { data: string }).data).toBe(
			"\u001b[2J\u001b[Htwo\nthree\n",
		);

		const [ended] = toSessionUpdates(
			{
				type: "session.tool_end",
				sessionId,
				toolCallId: "t6",
				toolName: "bash",
				args,
				content: [{ type: "text", text: "two\nthree\n\nCommand exited with code 2" }],
				details: undefined,
				isError: true,
			},
			state,
		);
		expect(ended).toMatchObject({ status: "failed" });
		expect(meta(ended).terminal_exit).toEqual({ terminal_id: info.terminal_id, exit_code: 2 });
		expect(ended).not.toHaveProperty("content");
		expect(state.terminals.has("t6")).toBe(false);
	});

	test("events with nothing to show produce nothing", () => {
		const state = createSessionState(cwd);
		expect(toSessionUpdates({ type: "session.created", sessionId, cwd }, state)).toEqual([]);
		expect(toSessionUpdates({ type: "session.message", sessionId, messageId: "m" }, state)).toEqual([]);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/updates.test.ts`
Expected: FAIL — cannot resolve `../../../src/engine/acp/updates.ts`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/acp/updates.ts
/**
 * Engine session events to ACP `session/update` notifications.
 *
 * Pure: one engine event plus the per-session state the mapping needs, out
 * come the updates to send, in order. The state remembers which tool calls
 * the client has been told about, which the user rejected, which already
 * carry a diff, and the display-only terminal that shows a shell tool's
 * output while it runs.
 */

import { randomUUID } from "node:crypto";
import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { SessionEvent, ToolContent } from "../events.ts";
import { toolKind, toolLocations, toolResultContent, toolTitle } from "./tools.ts";

/** Zed's meta key for a tool call's programmatic name (`acp_thread.rs`, `TOOL_NAME_META_KEY`). */
const TOOL_NAME_META_KEY = "tool_name";

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

/** Clear screen and home: sent when a snapshot no longer extends the previous one. */
const CLEAR = "\u001b[2J\u001b[H";

interface TerminalState {
	id: string;
	output: string;
}

export interface SessionState {
	cwd: string;
	/** Tool calls the client has been told about. */
	announced: Set<string>;
	/** Tool calls the user rejected; their end must not overwrite that status. */
	rejected: Set<string>;
	/** Tool calls whose card already shows a diff; their end must not replace it with text. */
	diffed: Set<string>;
	/** Display-only terminals by tool call id. */
	terminals: Map<string, TerminalState>;
}

export function createSessionState(cwd: string): SessionState {
	return { cwd, announced: new Set(), rejected: new Set(), diffed: new Set(), terminals: new Map() };
}

function textOf(content: readonly ToolContent[]): string {
	return content
		.filter((block): block is Extract<ToolContent, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/**
 * The bash tool reports a cumulative snapshot on every update, and tail
 * truncation can drop its head. Send the suffix when the snapshot extends
 * what the terminal shows, and repaint when it does not.
 */
function terminalDelta(terminal: TerminalState, snapshot: string): string | undefined {
	if (snapshot === terminal.output) return undefined;
	const delta = snapshot.startsWith(terminal.output) ? snapshot.slice(terminal.output.length) : CLEAR + snapshot;
	terminal.output = snapshot;
	return delta;
}

/** Success is 0; failure carries "Command exited with code N" in its text; a kill has none. */
function exitCodeOf(text: string, isError: boolean): number | null {
	if (!isError) return 0;
	const match = /Command exited with code (\d+)\s*$/.exec(text);
	return match ? Number(match[1]) : null;
}

function announce(
	event: Extract<SessionEvent, { type: "session.tool_call" | "session.tool_start" }>,
	state: SessionState,
	status: "pending" | "in_progress",
): SessionUpdate {
	const { toolCallId, toolName, args } = event;
	state.announced.add(toolCallId);
	const meta: Record<string, unknown> = { [TOOL_NAME_META_KEY]: toolName };
	let content: ToolCallContent[] | undefined;
	if (SHELL_TOOLS.has(toolName)) {
		const terminal: TerminalState = { id: randomUUID(), output: "" };
		state.terminals.set(toolCallId, terminal);
		meta.terminal_info = { terminal_id: terminal.id, cwd: state.cwd };
		content = [{ type: "terminal", terminalId: terminal.id }];
	}
	return {
		sessionUpdate: "tool_call",
		toolCallId,
		title: toolTitle(toolName, args, state.cwd),
		kind: toolKind(toolName),
		status,
		locations: toolLocations(toolName, args, state.cwd),
		rawInput: args,
		...(content ? { content } : {}),
		_meta: meta,
	};
}

export function toSessionUpdates(event: SessionEvent, state: SessionState): SessionUpdate[] {
	switch (event.type) {
		case "session.delta":
			return [
				{
					sessionUpdate: event.kind === "thinking" ? "agent_thought_chunk" : "agent_message_chunk",
					messageId: event.messageId,
					content: { type: "text", text: event.delta },
				},
			];
		case "session.tool_call":
			return [announce(event, state, "pending")];
		case "session.tool_start":
			return state.announced.has(event.toolCallId)
				? [{ sessionUpdate: "tool_call_update", toolCallId: event.toolCallId, status: "in_progress" }]
				: [announce(event, state, "in_progress")];
		case "session.tool_update": {
			const terminal = state.terminals.get(event.toolCallId);
			if (terminal) {
				const delta = terminalDelta(terminal, textOf(event.content));
				if (delta === undefined) return [];
				return [
					{
						sessionUpdate: "tool_call_update",
						toolCallId: event.toolCallId,
						status: "in_progress",
						_meta: { terminal_output: { terminal_id: terminal.id, data: delta } },
					},
				];
			}
			return [
				{
					sessionUpdate: "tool_call_update",
					toolCallId: event.toolCallId,
					status: "in_progress",
					content: toolResultContent(event.content),
				},
			];
		}
		case "session.tool_end": {
			const { toolCallId, content, isError } = event;
			const text = textOf(content);
			const terminal = state.terminals.get(toolCallId);
			state.terminals.delete(toolCallId);
			state.announced.delete(toolCallId);
			const rawOutput = { content: text, ...(event.details !== undefined ? { details: event.details } : {}) };
			if (state.rejected.delete(toolCallId)) {
				return [{ sessionUpdate: "tool_call_update", toolCallId, rawOutput }];
			}
			const status = isError ? "failed" : "completed";
			if (terminal) {
				const delta = terminalDelta(terminal, text);
				return [
					{
						sessionUpdate: "tool_call_update",
						toolCallId,
						status,
						rawOutput,
						_meta: {
							...(delta === undefined ? {} : { terminal_output: { terminal_id: terminal.id, data: delta } }),
							terminal_exit: { terminal_id: terminal.id, exit_code: exitCodeOf(text, isError) },
						},
					},
				];
			}
			if (state.diffed.delete(toolCallId)) {
				return [{ sessionUpdate: "tool_call_update", toolCallId, status, rawOutput }];
			}
			return [{ sessionUpdate: "tool_call_update", toolCallId, status, content: toolResultContent(content), rawOutput }];
		}
		default:
			return [];
	}
}
```

The terminal's final delta carries the tool's trailing status line
("Command exited with code 2") into the terminal; that is where a shell
user expects to see it.

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/updates.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/acp/updates.ts packages/cli/test/engine/acp/updates.test.ts
git commit -m "feat(engine): map session events to ACP session updates"
```

---

## Task 9: The agent

**Files:**
- Create: `packages/cli/src/engine/acp/agent.ts`
- Test: `packages/cli/test/engine/acp/agent.test.ts`

**Interfaces:**
- Consumes: Tasks 6–8; `agent`, `AgentApp`, `AgentContext`,
  `ClientCapabilities`, `PermissionOption`, `PROTOCOL_VERSION`,
  `RequestError`, `RequestPermissionResponse`, `SessionConfigOption`,
  `SessionUpdate`, `ToolCallContent`, `ToolCallUpdate` from the SDK;
  `applyEditsToNormalizedContent`, `Edit`, `normalizeToLF` from
  `../../core/tools/edit-diff.ts`; `splitBom` from `../../utils/text.ts`.
- Produces:
  - `export interface AcpAgentOptions { name?: string; version?: string }`
  - `export function createAcpAgent(engine: EngineClient, options?: AcpAgentOptions): AgentApp`
  - `export function toConfigOptions(summary: SessionSummary, models: readonly EngineModel[]): SessionConfigOption[]`

This is the module that meets Zed. Everything it does is one of: answer an
ACP request by calling the engine; forward an engine event as a
`session/update`; answer an engine request by calling the client. The one
piece of computation of its own is the permission preview: for an `edit` or
`write`, the diff the user is asked to approve is computed the way the tool
will compute it, from the editor's current buffer text, so approval is of
the actual change. The test harness is the in-process `client().connect(app)`
composition verified in §1.7; production stdio is Task 10.

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/acp/agent.test.ts
import {
	type ActiveSession,
	type ClientConnection,
	client,
	PROTOCOL_VERSION,
	RequestError,
	type RequestPermissionRequest,
	type SessionUpdate,
	type StopReason,
} from "@agentclientprotocol/sdk";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, type FauxProviderHandle, fauxText, fauxToolCall } from "@knightcode/ai";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAcpAgent } from "../../../src/engine/acp/agent.ts";
import { createEngineClient } from "../../../src/engine/acp/engine-client.ts";
import { createEngineContext } from "../../../src/engine/context.ts";
import { createEventBus, eventsRoute } from "../../../src/engine/events.ts";
import { modelsRoute } from "../../../src/engine/models.ts";
import { type EngineServer, startEngineServer } from "../../../src/engine/server.ts";
import { sessionRoutes } from "../../../src/engine/session-routes.ts";
import { createSessionRegistry, type SessionRegistry } from "../../../src/engine/sessions.ts";

type Decision = (request: RequestPermissionRequest) => "allow_once" | "allow_always" | "reject_once";

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Read updates until the turn stops. */
async function collect(session: ActiveSession): Promise<{ updates: SessionUpdate[]; stopReason: StopReason }> {
	const updates: SessionUpdate[] = [];
	for (;;) {
		const message = await session.nextUpdate();
		if (message.kind === "stop") return { updates, stopReason: message.stopReason };
		updates.push(message.update);
	}
}

function textOf(updates: readonly SessionUpdate[], kind: "agent_message_chunk" | "agent_thought_chunk"): string {
	return updates
		.filter((update) => update.sessionUpdate === kind)
		.map((update) => (update.sessionUpdate === kind && update.content.type === "text" ? update.content.text : ""))
		.join("");
}

function kinds(updates: readonly SessionUpdate[]): string[] {
	// Deltas arrive token-sized; collapse runs so the shape of the turn is what is asserted.
	return updates
		.map((update) => update.sessionUpdate)
		.filter((kind, index, all) => index === 0 || kind !== all[index - 1] || !kind.endsWith("_chunk"));
}

describe("ACP agent", () => {
	let counter = 0;
	let server: EngineServer | undefined;
	let registry: SessionRegistry | undefined;
	let connection: ClientConnection | undefined;
	const dirs: string[] = [];

	afterEach(async () => {
		connection?.close();
		connection = undefined;
		await registry?.closeAll();
		await server?.close();
		registry = undefined;
		server = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(options: { tokensPerSecond?: number } = {}): Promise<{
		cwd: string;
		faux: FauxProviderHandle;
		buffers: Map<string, string>;
		permissions: RequestPermissionRequest[];
		session: ActiveSession;
		decide(decision: Decision): void;
	}> {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-acp-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-acp-agent-"));
		dirs.push(cwd, agentDir);
		const events = createEventBus();
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null, events });
		const faux = fauxProvider({ provider: `faux-acp-${counter++}`, tokensPerSecond: options.tokensPerSecond });
		ctx.models.registerNativeProvider(faux.provider);
		registry = createSessionRegistry(ctx, { agentDir, sessionDir: null, defaultModel: faux.getModel() });
		server = await startEngineServer({
			token: "t",
			routes: [eventsRoute(events, 50), modelsRoute(ctx), ...sessionRoutes(ctx, registry)],
		});
		const engine = createEngineClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "t", reconnectDelayMs: 10 });

		// The editor: buffers it owns, and a permission policy the test can change.
		const buffers = new Map<string, string>();
		const permissions: RequestPermissionRequest[] = [];
		let decision: Decision = () => "allow_once";
		const editor = client({ name: "test-editor" })
			.onRequest("fs/read_text_file", ({ params }) => {
				const content = buffers.get(params.path);
				if (content === undefined) throw RequestError.resourceNotFound(params.path);
				return { content };
			})
			.onRequest("fs/write_text_file", ({ params }) => {
				buffers.set(params.path, params.content);
				return {};
			})
			.onRequest("session/request_permission", ({ params }) => {
				permissions.push(params);
				return { outcome: { outcome: "selected", optionId: decision(params) } };
			});
		connection = editor.connect(createAcpAgent(engine, { name: "knightcode-test", version: "0.0.0" }));
		await connection.agent.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
		});
		const session = await connection.agent.buildSession(cwd).start();
		return {
			cwd,
			faux,
			buffers,
			permissions,
			session,
			decide: (next) => {
				decision = next;
			},
		};
	}

	test("initialize and session/new advertise what Zed needs", async () => {
		const { faux, session } = await start();
		const init = await connection!.agent.request("initialize", { protocolVersion: PROTOCOL_VERSION });
		expect(init.protocolVersion).toBe(1);
		expect(init.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
		expect(init.agentCapabilities?.sessionCapabilities?.close).toBeDefined();
		expect(init.agentInfo?.name).toBe("knightcode-test");

		const options = session.newSessionResponse.configOptions ?? [];
		const model = options.find((option) => option.id === "model");
		expect(model?.type === "select" ? model.currentValue : undefined).toBe(`${faux.provider.id}/${faux.getModel().id}`);
		expect(options.find((option) => option.id === "thinking")?.category).toBe("thought_level");
	});

	test("a turn streams text, edits through the editor with a reviewed diff, and ends", async () => {
		const { cwd, faux, buffers, permissions, session } = await start();
		const path = join(cwd, "a.txt");
		buffers.set(path, "hello world\n");
		writeFileSync(path, "hello world\n");
		// One assistant message carrying text and the call, as a real provider streams it.
		faux.setResponses([
			fauxAssistantMessage(
				[fauxText("Editing."), fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxText("Done.")]),
		]);

		const done = session.prompt("change world to there");
		const { updates, stopReason } = await collect(session);
		await done;

		expect(stopReason).toBe("end_turn");
		expect(textOf(updates, "agent_message_chunk")).toBe("Editing.Done.");
		expect(kinds(updates)).toEqual([
			"agent_message_chunk",
			"tool_call",
			"tool_call_update", // in progress
			"tool_call_update", // the diff, at write time
			"tool_call_update", // completed
			"agent_message_chunk",
			"usage_update",
		]);

		const [announced] = updates.filter((update) => update.sessionUpdate === "tool_call");
		expect(announced).toMatchObject({ title: "Edit a.txt", kind: "edit", status: "pending", locations: [{ path }] });

		expect(permissions).toHaveLength(1);
		expect(permissions[0].toolCall.toolCallId).toBe(announced.sessionUpdate === "tool_call" ? announced.toolCallId : "");
		expect(permissions[0].toolCall.content).toEqual([
			{ type: "diff", path, oldText: "hello world\n", newText: "hello there\n" },
		]);
		expect(permissions[0].options.map((option) => option.kind)).toEqual(["allow_once", "allow_always", "reject_once"]);

		const diffed = updates.find(
			(update) => update.sessionUpdate === "tool_call_update" && Array.isArray(update.content) && update.content.length > 0,
		);
		expect(diffed).toMatchObject({
			kind: "edit",
			content: [{ type: "diff", path, oldText: "hello world\n", newText: "hello there\n" }],
		});
		const completed = updates.filter((update) => update.sessionUpdate === "tool_call_update").at(-1);
		expect(completed).toMatchObject({ status: "completed" });
		expect(completed).not.toHaveProperty("content");

		expect(buffers.get(path)).toBe("hello there\n");
		expect(readFileSync(path, "utf-8")).toBe("hello world\n");
		expect(updates.at(-1)).toMatchObject({ sessionUpdate: "usage_update", size: faux.getModel().contextWindow });
	});

	test("a rejected permission leaves the buffer alone and the call rejected", async () => {
		const { cwd, faux, buffers, session, decide } = await start();
		decide(() => "reject_once");
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "new.txt", content: "created" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Understood.")]),
		]);
		const done = session.prompt("create a file");
		const { updates, stopReason } = await collect(session);
		await done;
		expect(stopReason).toBe("end_turn");
		expect(buffers.has(join(cwd, "new.txt"))).toBe(false);
		const ended = updates.filter((update) => update.sessionUpdate === "tool_call_update").at(-1);
		expect(ended).not.toHaveProperty("status");
		expect(textOf(updates, "agent_message_chunk")).toBe("Understood.");
	});

	test("cancel answers cancelled and the session takes the next prompt", async () => {
		const { faux, session } = await start({ tokensPerSecond: 20 });
		faux.setResponses([fauxAssistantMessage([fauxText("d".repeat(400))])]);
		const first = session.prompt("slow");
		const firstChunk = await session.nextUpdate();
		expect(firstChunk.kind).toBe("session_update");
		await connection!.agent.notify("session/cancel", { sessionId: session.sessionId });
		expect((await first).stopReason).toBe("cancelled");
		// Drain whatever was in flight before the stop.
		for (;;) {
			const message = await session.nextUpdate();
			if (message.kind === "stop") break;
		}

		faux.setResponses([fauxAssistantMessage([fauxText("again")])]);
		const second = session.prompt("next");
		const { stopReason, updates } = await collect(session);
		await second;
		expect(stopReason).toBe("end_turn");
		expect(textOf(updates, "agent_message_chunk")).toBe("again");
	});

	test("a path the editor does not own is read from disk", async () => {
		const { cwd, faux, session } = await start();
		writeFileSync(join(cwd, "disk-only.txt"), "only on disk");
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "disk-only.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("read it")]),
		]);
		const done = session.prompt("read");
		const { updates } = await collect(session);
		await done;
		const completed = updates.filter((update) => update.sessionUpdate === "tool_call_update").at(-1);
		expect(completed).toMatchObject({
			status: "completed",
			content: [{ type: "content", content: { type: "text", text: "only on disk" } }],
		});
	});

	test("set_config_option changes the thinking level", async () => {
		const { session } = await start();
		const options = session.newSessionResponse.configOptions ?? [];
		const thinking = options.find((option) => option.id === "thinking");
		if (thinking?.type !== "select") throw new Error("thinking is not a select");
		// Thinking levels are a flat list, not groups.
		const values = (thinking.options as { value: string }[]).map((option) => option.value);
		const next = values.find((value) => value !== thinking.currentValue);
		expect(next).toBeDefined();
		const response = await connection!.agent.request("session/set_config_option", {
			sessionId: session.sessionId,
			configId: "thinking",
			value: next!,
		});
		const updated = response.configOptions.find((option) => option.id === "thinking");
		expect(updated?.type === "select" ? updated.currentValue : undefined).toBe(next);
	});

	test("closing the connection closes the sessions on the engine", async () => {
		await start();
		expect(registry!.size()).toBe(1);
		connection!.close();
		connection = undefined;
		await until(() => registry!.size() === 0);
	});
});
```

The test editor throws `RequestError.resourceNotFound` for a path it does
not hold, which is what Zed does for a path outside the project
(`acp_thread.rs` 4325–4330); the disk-fallback test rests on the adapter
recognising that code.

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/agent.test.ts`
Expected: FAIL — cannot resolve `../../../src/engine/acp/agent.ts`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/acp/agent.ts
/**
 * The ACP agent.
 *
 * Speaks ACP to the editor on one side and the engine's HTTP API on the
 * other, and holds nothing of its own beyond the bookkeeping the mapping
 * needs. The editor owns the filesystem: every read and write the engine's
 * tools make arrives here as a client request and is answered with
 * `fs/read_text_file` and `fs/write_text_file`, which is what puts agent
 * edits into the editor's buffers under review instead of onto disk behind
 * its back.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	agent,
	type AgentApp,
	type AgentContext,
	type ClientCapabilities,
	type PermissionOption,
	PROTOCOL_VERSION,
	RequestError,
	type RequestPermissionResponse,
	type SessionConfigOption,
	type SessionConfigSelectGroup,
	type SessionUpdate,
	type ToolCallContent,
	type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { applyEditsToNormalizedContent, type Edit, normalizeToLF } from "../../core/tools/edit-diff.ts";
import { splitBom } from "../../utils/text.ts";
import type { ClientReply, ClientRequest, PermissionOutcome } from "../client-requests.ts";
import type { EngineEvent } from "../events.ts";
import type { EngineModel } from "../models.ts";
import type { SessionSummary } from "../sessions.ts";
import { toPromptInput } from "./content.ts";
import { type EngineClient, EngineRequestError } from "./engine-client.ts";
import { toolKind, toolLocations, toolTitle } from "./tools.ts";
import { createSessionState, type SessionState, toSessionUpdates } from "./updates.ts";

export interface AcpAgentOptions {
	name?: string;
	version?: string;
}

type TurnEnd = Extract<EngineEvent, { type: "session.turn_end" }>;

interface AdapterSession {
	summary: SessionSummary;
	state: SessionState;
	/** What the client returned for a path during a tool call: the old side of that call's diff. */
	reads: Map<string, string>;
	turn?: { resolve(end: TurnEnd): void; reject(error: Error): void };
}

const PERMISSION_OPTIONS: readonly (PermissionOption & { optionId: PermissionOutcome })[] = [
	{ optionId: "allow_once", name: "Allow", kind: "allow_once" },
	{ optionId: "allow_always", name: "Always allow", kind: "allow_always" },
	{ optionId: "reject_once", name: "Reject", kind: "reject_once" },
];

const readKey = (toolCallId: string, path: string): string => `${toolCallId}\u0000${path}`;

function toOutcome(response: RequestPermissionResponse): PermissionOutcome {
	const { outcome } = response;
	if (outcome.outcome !== "selected") return "cancelled";
	return PERMISSION_OPTIONS.find((option) => option.optionId === outcome.optionId)?.optionId ?? "cancelled";
}

/** Engine failures as the JSON-RPC errors Zed acts on: auth_required opens sign-in, internal shows `details`. */
function toRequestError(error: unknown): RequestError {
	if (error instanceof RequestError) return error;
	if (error instanceof EngineRequestError) {
		if (error.status === 401) return RequestError.authRequired({ details: error.message });
		if (error.status === 404) return RequestError.resourceNotFound(error.message);
		if (error.status === 400) return RequestError.invalidParams({ details: error.message });
	}
	return RequestError.internalError({ details: error instanceof Error ? error.message : String(error) });
}

async function withEngine<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw toRequestError(error);
	}
}

export function toConfigOptions(summary: SessionSummary, models: readonly EngineModel[]): SessionConfigOption[] {
	const options: SessionConfigOption[] = [];
	if (summary.model) {
		const groups = new Map<string, SessionConfigSelectGroup>();
		for (const model of models) {
			const group = groups.get(model.providerId) ?? { group: model.providerId, name: model.providerName, options: [] };
			group.options.push({ value: model.ref, name: model.name });
			groups.set(model.providerId, group);
		}
		// The current model is always selectable, even when the catalog has moved on.
		if (!models.some((model) => model.ref === summary.model?.ref)) {
			groups.set(summary.model.providerId, {
				group: summary.model.providerId,
				name: summary.model.providerId,
				options: [{ value: summary.model.ref, name: summary.model.name }],
			});
		}
		options.push({
			id: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: summary.model.ref,
			options: [...groups.values()],
		});
	}
	options.push({
		id: "thinking",
		name: "Thinking",
		category: "thought_level",
		type: "select",
		currentValue: summary.thinkingLevel,
		options: summary.thinkingLevels.map((level) => ({ value: level, name: level })),
	});
	return options;
}

function isEdits(value: unknown): value is Edit[] {
	return (
		Array.isArray(value) &&
		value.every(
			(edit) =>
				typeof edit === "object" &&
				edit !== null &&
				typeof (edit as Edit).oldText === "string" &&
				typeof (edit as Edit).newText === "string",
		)
	);
}

async function readForPreview(
	cx: AgentContext,
	sessionId: string,
	path: string,
	canRead: boolean,
): Promise<string | undefined> {
	try {
		if (canRead) return (await cx.request("fs/read_text_file", { sessionId, path })).content;
		return await readFile(path, "utf-8");
	} catch {
		return undefined;
	}
}

/**
 * The change an edit or write will make, computed the way the tool computes
 * it from the editor's current text, so the user approves the actual change.
 * Absent when the edit will not apply; the tool then reports why.
 */
async function editPreview(
	cx: AgentContext,
	sessionId: string,
	toolName: string,
	input: unknown,
	cwd: string,
	canRead: boolean,
): Promise<ToolCallContent[] | undefined> {
	if (toolName !== "edit" && toolName !== "write") return undefined;
	const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	if (typeof args.path !== "string") return undefined;
	const path = isAbsolute(args.path) ? args.path : resolve(cwd, args.path);
	const current = await readForPreview(cx, sessionId, path, canRead);
	if (toolName === "write") {
		if (typeof args.content !== "string") return undefined;
		return [{ type: "diff", path, oldText: current ?? null, newText: args.content }];
	}
	if (current === undefined || !isEdits(args.edits)) return undefined;
	try {
		const { baseContent, newContent } = applyEditsToNormalizedContent(
			normalizeToLF(splitBom(current).text),
			args.edits,
			path,
		);
		return [{ type: "diff", path, oldText: baseContent, newText: newContent }];
	} catch {
		return undefined;
	}
}

export function createAcpAgent(engine: EngineClient, options: AcpAgentOptions = {}): AgentApp {
	const name = options.name ?? "knightcode";
	const sessions = new Map<string, AdapterSession>();
	let client: AgentContext | undefined;
	let capabilities: ClientCapabilities = {};

	const canRead = (): boolean => capabilities.fs?.readTextFile === true;
	const canWrite = (): boolean => capabilities.fs?.writeTextFile === true;

	function requireClient(): AgentContext {
		if (!client) throw RequestError.internalError({ details: "no client connection" });
		return client;
	}

	function requireSession(sessionId: string): AdapterSession {
		const session = sessions.get(sessionId);
		if (!session) throw RequestError.invalidParams({ sessionId }, "unknown session");
		return session;
	}

	async function notify(sessionId: string, update: SessionUpdate): Promise<void> {
		await requireClient().notify("session/update", { sessionId, update });
	}

	async function configOptions(summary: SessionSummary): Promise<SessionConfigOption[]> {
		return toConfigOptions(summary, await engine.models());
	}

	function settleTurn(session: AdapterSession, end: TurnEnd): void {
		session.turn?.resolve(end);
		session.turn = undefined;
	}

	function failTurns(reason: string): void {
		for (const session of sessions.values()) {
			session.turn?.reject(new Error(reason));
			session.turn = undefined;
		}
	}

	async function closeAll(): Promise<void> {
		const open = [...sessions.keys()];
		sessions.clear();
		for (const id of open) await engine.closeSession(id).catch(() => undefined);
	}

	async function answer(session: AdapterSession, request: ClientRequest): Promise<ClientReply> {
		const sessionId = session.summary.id;
		const cx = requireClient();
		switch (request.kind) {
			case "fs.read": {
				const { content } = await cx.request("fs/read_text_file", { sessionId, path: request.path });
				if (request.toolCallId) session.reads.set(readKey(request.toolCallId, request.path), content);
				return { kind: "fs.read", content };
			}
			case "fs.write": {
				// The old side of the diff is what the tool read, or what the editor
				// holds now for a tool that writes without reading.
				const known = request.toolCallId ? session.reads.get(readKey(request.toolCallId, request.path)) : undefined;
				const oldText = known ?? (await readForPreview(cx, sessionId, request.path, canRead()));
				await cx.request("fs/write_text_file", { sessionId, path: request.path, content: request.content });
				if (request.toolCallId) {
					session.state.diffed.add(request.toolCallId);
					await notify(sessionId, {
						sessionUpdate: "tool_call_update",
						toolCallId: request.toolCallId,
						kind: "edit",
						locations: [{ path: request.path }],
						content: [{ type: "diff", path: request.path, oldText: oldText ?? null, newText: request.content }],
					});
				}
				return { kind: "fs.write" };
			}
			case "permission": {
				const { cwd } = session.state;
				const content = await editPreview(cx, sessionId, request.toolName, request.input, cwd, canRead());
				const toolCall: ToolCallUpdate = {
					toolCallId: request.toolCallId,
					title: toolTitle(request.toolName, request.input, cwd),
					kind: toolKind(request.toolName),
					status: "pending",
					locations: toolLocations(request.toolName, request.input, cwd),
					rawInput: request.input,
					...(content ? { content } : {}),
					_meta: { tool_name: request.toolName },
				};
				const response = await cx.request("session/request_permission", {
					sessionId,
					toolCall,
					options: [...PERMISSION_OPTIONS],
				});
				const outcome = toOutcome(response);
				if (outcome === "reject_once" || outcome === "reject_always") session.state.rejected.add(request.toolCallId);
				return { kind: "permission", outcome };
			}
		}
	}

	async function handleRequest(session: AdapterSession, requestId: string, request: ClientRequest): Promise<void> {
		let reply: ClientReply;
		try {
			reply = await answer(session, request);
		} catch (error) {
			const notFound = error instanceof RequestError && error.code === -32002;
			reply = {
				kind: "error",
				code: notFound ? "not_found" : "failed",
				message: error instanceof Error ? error.message : String(error),
			};
		}
		try {
			await engine.reply(session.summary.id, requestId, reply);
		} catch (error) {
			// The engine forgets a request it has aborted; a late answer is not a fault.
			if (!(error instanceof EngineRequestError && error.status === 404)) throw error;
		}
	}

	async function handleEvent(event: EngineEvent): Promise<void> {
		if (!("sessionId" in event)) return;
		const session = sessions.get(event.sessionId);
		if (!session) return;
		switch (event.type) {
			case "session.request":
				// Not awaited: a permission prompt can wait on the user for minutes, and
				// other sessions' events must keep flowing meanwhile.
				void handleRequest(session, event.requestId, event.request);
				return;
			case "session.turn_end":
				settleTurn(session, event);
				return;
			case "session.tool_end":
				for (const key of [...session.reads.keys()]) {
					if (key.startsWith(`${event.toolCallId}\u0000`)) session.reads.delete(key);
				}
				break;
			default:
				break;
		}
		for (const update of toSessionUpdates(event, session.state)) await notify(event.sessionId, update);
	}

	return agent({ name })
		.onConnect((connection) => {
			client = connection.client;
			void engine.events(
				{ onEvent: handleEvent, onDisconnect: () => failTurns("engine event stream disconnected") },
				connection.signal,
			);
			void connection.closed.then(closeAll);
		})
		.onRequest("initialize", ({ params }) => {
			capabilities = params.clientCapabilities ?? {};
			return {
				protocolVersion: PROTOCOL_VERSION,
				agentCapabilities: {
					loadSession: false,
					promptCapabilities: { image: true, embeddedContext: true },
					sessionCapabilities: { close: {} },
				},
				authMethods: [
					{
						id: "knightcode-cli",
						name: "Sign in with the KnightCode CLI",
						description: "Run `knightcode` and use /login. The CLI and this agent share one credential store.",
					},
				],
				agentInfo: { name, version: options.version ?? "0.0.0" },
			};
		})
		.onRequest("authenticate", () => ({}))
		.onRequest("session/new", async ({ params }) => {
			const summary = await withEngine(() =>
				engine.createSession({
					cwd: params.cwd,
					capabilities: { readTextFile: canRead(), writeTextFile: canWrite() },
				}),
			);
			sessions.set(summary.id, { summary, state: createSessionState(summary.cwd), reads: new Map() });
			return { sessionId: summary.id, configOptions: await configOptions(summary) };
		})
		.onRequest("session/prompt", async ({ params }) => {
			const session = requireSession(params.sessionId);
			const end = new Promise<TurnEnd>((resolve, reject) => {
				session.turn = { resolve, reject };
			});
			try {
				await withEngine(() => engine.prompt(session.summary.id, toPromptInput(params.prompt)));
			} catch (error) {
				session.turn = undefined;
				throw error;
			}
			const outcome = await end.catch((error: Error) => {
				throw RequestError.internalError({ details: error.message });
			});
			if (outcome.usage) {
				await notify(session.summary.id, {
					sessionUpdate: "usage_update",
					used: outcome.usage.used ?? 0,
					size: outcome.usage.size,
					cost: { amount: outcome.usage.cost, currency: "USD" },
				});
			}
			if (outcome.stopReason === "error") throw RequestError.internalError({ details: outcome.error ?? "the turn failed" });
			return { stopReason: outcome.stopReason };
		})
		.onNotification("session/cancel", async ({ params }) => {
			const session = sessions.get(params.sessionId);
			if (session) await engine.cancel(session.summary.id).catch(() => undefined);
		})
		.onRequest("session/close", async ({ params }) => {
			const session = sessions.get(params.sessionId);
			if (!session) return {};
			sessions.delete(params.sessionId);
			settleTurn(session, { type: "session.turn_end", sessionId: params.sessionId, stopReason: "cancelled" });
			await engine.closeSession(session.summary.id).catch(() => undefined);
			return {};
		})
		.onRequest("session/set_config_option", async ({ params }) => {
			const session = requireSession(params.sessionId);
			if (typeof params.value !== "string") throw RequestError.invalidParams({ configId: params.configId });
			const patch =
				params.configId === "model"
					? { model: params.value }
					: params.configId === "thinking"
						? { thinkingLevel: params.value }
						: undefined;
			if (!patch) throw RequestError.invalidParams({ configId: params.configId }, "unknown config option");
			session.summary = await withEngine(() => engine.updateSession(session.summary.id, patch));
			return { configOptions: await configOptions(session.summary) };
		});
}
```

Two things to confirm while implementing, both cheap: that a client
handler which throws `RequestError.resourceNotFound` reaches the agent's
`request` as a rejection whose `code` is `-32002` (the disk-fallback test
fails otherwise; if the SDK rethrows a different class, match on `code`
alone), and that `SessionConfigSelectGroup` is the exported name for the
grouped select options (`types.gen.d.ts` 2703).

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/agent.test.ts`
Expected: PASS, 7 tests. The edit test is the one that proves the product
claim: the buffer changed, the disk did not, and the user was shown the
exact diff before it happened.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/acp/agent.ts packages/cli/test/engine/acp/agent.test.ts
git commit -m "feat(engine): add the ACP agent over the engine client"
```

---

## Task 10: Entry points

**Files:**
- Create: `packages/cli/src/engine/acp/run.ts`
- Create: `packages/cli/src/engine/acp/entry.ts`
- Modify: `packages/cli/src/engine-entry.ts` (the `acp` subcommand)
- Test: `packages/cli/test/engine/acp/entry.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 9; `ndJsonStream` from the SDK.
- Produces:
  - `run.ts`: `export interface RunAcpOptions { connect?: string; token?: string; version?: string }`,
    `export function parseAcpArgs(argv: readonly string[]): RunAcpOptions`,
    `export async function runAcp(argv: readonly string[]): Promise<void>` —
    resolves when the client disconnects.
  - `entry.ts`: the `bun run` entrypoint for stock Zed; no exports.
  - `engine-entry.ts`: `knightcode-engine acp [--connect <url>]` runs the
    adapter instead of the server.

stdout is the protocol channel. The in-process engine must not print its
port line (that is `engine-entry.ts` line 54, which this path never
reaches), and `console.log` is pointed at stderr so an extension that logs
cannot corrupt the stream. stdin and stdout are bridged by hand the way
OpenCode does (`acp.ts` 33–51): a write that waits for the callback keeps
backpressure, and `data`/`end`/`error` on stdin map onto the readable
without a Node-to-web conversion that behaves differently under Bun.

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/acp/entry.test.ts
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseAcpArgs } from "../../../src/engine/acp/run.ts";

const ENTRY = resolve(import.meta.dirname, "../../../src/engine/acp/entry.ts");

describe("acp entry", () => {
	let child: ChildProcess | undefined;
	const dirs: string[] = [];

	afterEach(() => {
		child?.kill();
		child = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	test("parses --connect and takes the token from the environment", () => {
		expect(parseAcpArgs(["--connect", "http://127.0.0.1:1"])).toMatchObject({ connect: "http://127.0.0.1:1" });
		expect(parseAcpArgs([]).connect).toBeUndefined();
	});

	// The one process test in this suite. It boots a real engine in-process
	// against a throwaway agent directory, so no credential of the developer's
	// is read and no model is resolved; it creates no session.
	test("answers initialize over stdio and exits when stdin closes", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-acp-entry-"));
		dirs.push(agentDir);
		child = spawn("bun", ["run", ENTRY], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir, KNIGHTCODE_OFFLINE: "1" },
		});
		const stdout: string[] = [];
		child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf-8")));
		const stderr: string[] = [];
		child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf-8")));

		child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })}\n`);
		await waitFor(() => stdout.join("").includes("\n"), 20_000);
		const [line] = stdout.join("").split("\n");
		const response = JSON.parse(line) as { id: number; result?: { protocolVersion: number; agentInfo?: { name: string } } };
		expect(response.id).toBe(1);
		expect(response.result?.protocolVersion).toBe(1);
		expect(response.result?.agentInfo?.name).toBe("knightcode");
		// Nothing but JSON-RPC on stdout: no port line, no log line.
		expect(stdout.join("").split("\n").filter((entry) => entry.length > 0)).toHaveLength(1);

		const exited = new Promise<number | null>((resolveExit) => child!.once("exit", (code) => resolveExit(code)));
		child.stdin!.end();
		expect(await Promise.race([exited, timeout(10_000)])).toBe(0);
		child = undefined;
		if (stderr.join("").length > 0) console.error(stderr.join(""));
	}, 40_000);
});

async function waitFor(predicate: () => boolean, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolveTick) => setTimeout(resolveTick, 25));
	}
}

function timeout(ms: number): Promise<never> {
	return new Promise((_, reject) => setTimeout(() => reject(new Error("the adapter did not exit")), ms));
}
```

`import.meta.dirname` exists on Node 20.11+ and Bun; the suite runs on Node
24. On Windows `spawn("bun", ...)` resolves `bun.exe` on `PATH`; if the
developer's shell only has a shim, set `shell: true`.

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/entry.test.ts`
Expected: FAIL — cannot resolve `../../../src/engine/acp/run.ts`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/acp/run.ts
/**
 * Runs the ACP adapter over stdio.
 *
 * stdout is the protocol channel and nothing else may write to it. Anything
 * an extension logs goes to stderr, which the editor shows in its agent
 * log. Without `--connect` the adapter starts an engine in-process, as the
 * standalone binary would, and talks to it over loopback; with it, the
 * adapter attaches to the engine the IDE already runs, with the launch
 * token from `KNIGHTCODE_ENGINE_TOKEN` — never from argv, where any process
 * on the machine could read it.
 */

import { randomBytes } from "node:crypto";
import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { createEngineContext } from "../context.ts";
import { engineRoutes } from "../routes.ts";
import { startEngineServer } from "../server.ts";
import { createSessionRegistry } from "../sessions.ts";
import { createAcpAgent } from "./agent.ts";
import { createEngineClient } from "./engine-client.ts";

export interface RunAcpOptions {
	connect?: string;
	token?: string;
	version?: string;
}

export function parseAcpArgs(argv: readonly string[]): RunAcpOptions {
	const options: RunAcpOptions = { token: process.env.KNIGHTCODE_ENGINE_TOKEN };
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--connect") options.connect = argv[++index];
	}
	return options;
}

function stdioStream(): Stream {
	const output = new WritableStream<Uint8Array>({
		write: (chunk) =>
			new Promise<void>((resolve, reject) => {
				process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()));
			}),
	});
	const input = new ReadableStream<Uint8Array>({
		start(controller) {
			process.stdin.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
			process.stdin.on("end", () => controller.close());
			process.stdin.on("error", (error) => controller.error(error));
		},
	});
	return ndJsonStream(output, input);
}

export async function runAcp(argv: readonly string[]): Promise<void> {
	const options = parseAcpArgs(argv);

	// A stray console.log from an extension would corrupt the JSON-RPC stream.
	console.log = console.error.bind(console);
	console.info = console.error.bind(console);
	console.debug = console.error.bind(console);

	let baseUrl = options.connect;
	let token = options.token;
	let stopEngine: () => Promise<void> = async () => {};
	if (baseUrl === undefined) {
		token = randomBytes(24).toString("hex");
		const ctx = await createEngineContext({ allowModelNetwork: true });
		const sessions = createSessionRegistry(ctx);
		const server = await startEngineServer({ token, routes: engineRoutes(ctx, sessions) });
		baseUrl = `http://127.0.0.1:${server.port}`;
		stopEngine = async () => {
			await sessions.closeAll();
			await server.close();
		};
	} else if (!token) {
		throw new Error("KNIGHTCODE_ENGINE_TOKEN must be set when connecting to a running engine");
	}

	const engine = createEngineClient({ baseUrl, token });
	const connection = createAcpAgent(engine, { version: options.version }).connect(stdioStream());
	const stop = () => connection.close();
	process.stdin.once("end", stop);
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	process.stdin.resume();
	await connection.closed;
	await stopEngine();
}
```

```ts
// packages/cli/src/engine/acp/entry.ts
#!/usr/bin/env bun
/**
 * knightcode-engine acp, runnable from source: the entry a stock Zed
 * `agent_servers` entry points at before the fork exists.
 */

// Static, and first, for the reason engine-entry.ts gives: the OAuth flows
// behind the shared credential store load through this in a compiled binary.
import "../../bun/runtime-setup.ts";
import { runAcp } from "./run.ts";

process.title = "knightcode-acp";
process.env.KNIGHTCODE_CODING_AGENT = "true";
process.env.AI_AGENT = "knightcode";

await runAcp(process.argv.slice(2));
process.exit(0);
```

In `engine-entry.ts`, after the `process.env.AI_AGENT` line and before the
token check:

```ts
import { runAcp } from "./engine/acp/run.ts";
// ...
// `knightcode-engine acp` is the adapter, not the server: it makes its own
// token when it boots an engine, so the check below does not apply.
if (process.argv[2] === "acp") {
	await runAcp(process.argv.slice(3));
	process.exit(0);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/acp/entry.test.ts`
Expected: PASS, 2 tests. If the process test hangs after `stdin.end()`,
the SDK did not close the connection when the readable closed; the
`process.stdin.once("end", stop)` line is there for that case, so check it
ran before looking further.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine/acp/run.ts packages/cli/src/engine/acp/entry.ts packages/cli/src/engine-entry.ts packages/cli/test/engine/acp/entry.test.ts
git commit -m "feat(engine): add the acp entrypoint"
```

---

## Task 11: Validate against stock Zed

**Files:** none in this repository. Zed's user settings file, a scratch
project, and this document's Validation record.

A client we did not write cannot hide our bugs. Three scenarios, each
exercising a path no test above can: Zed's real buffers, its real
permission UI, and its real cancel.

- [x] **Step 1: Register the adapter**

In Zed's `settings.json` (`crates/settings_content/src/agent.rs` 739–760
is the schema). Use the absolute path of this checkout and forward slashes
on Windows:

```json
{
	"agent_servers": {
		"KnightCode": {
			"type": "custom",
			"command": "bun",
			"args": ["run", "<abs>/packages/cli/src/engine/acp/entry.ts"],
			"env": {}
		}
	}
}
```

Sign in through the CLI first (`knightcode`, then `/login`); the adapter
shares `auth.json` and needs no login of its own. Open a scratch project
with two or three small files and a git repository, open the agent panel,
pick KnightCode. Zed's agent log (`dev: open acp logs`) shows every message
on the wire and the adapter's stderr.

- [x] **Step 2: Multi-file edit with diff review**

Prompt: "Rename the function `greet` to `welcome` across the project and
update its callers." Expect, in order: a permission card per file with a
diff of the actual change; after Allow, the edit applied in the buffer;
the review multibuffer listing each hunk with accept and reject; the file
on disk saved by Zed, not by the engine. Reject one hunk and confirm the
buffer reverts it. If Zed shows the edit but no review hunks, the write
went to disk: check that the session was created with both fs capabilities
(`session.created` in the adapter's stderr is a good place to log them).

- [x] **Step 3: Permission prompt on a shell command**

Prompt: "Run the test suite." Expect a permission card titled with the
command, an embedded terminal on Allow that fills as the command runs, and
the exit code reflected in the card's status. Then "Always allow" once and
confirm the next shell command in the same thread runs without asking, and
that a new thread asks again.

- [x] **Step 4: Mid-turn cancel**

Prompt something long ("Explain every file in this project in detail") and
press stop while text is streaming. Expect the turn to end within a second
with no error banner, the partial text to stay, and the next prompt in the
same thread to work. Then cancel while a permission card is showing and
confirm the card resolves as cancelled and the turn ends.

- [x] **Step 5: Record**

Append to the Validation section below: Zed version, OS, date, and one line
per scenario with what was observed. A scenario that needed a fix gets the
commit hash of the fix.

---

## Implementation notes

Where the code departs from the task text above, and why. Line numbers in
the task text are unchanged; the tests in the tree are authoritative.

- `session.tool_end` carries no `args`: `AgentEvent`'s `tool_execution_end`
  has none, and nothing downstream reads it (the adapter only needs `args`
  at announce time).
- The tool scope in `client-fs.ts` carries the loop's abort signal alongside
  the tool call id, so a parked `fs.read`/`fs.write` releases the tool when
  the turn is aborted by any path, not only through the registry's `cancel`.
- `SessionRegistry.create` resolves `cwd` and refuses one that is not a
  directory with `bad_request`; the prompt route refuses an empty prompt
  (no text, no images) with `bad_request`.
- `readForPreview` in `agent.ts` falls back to disk when the client's read
  fails, not only when the client lacks the capability, so the diff shown
  at permission time matches what the tool will actually read.
- `SessionState.cancelling`: a tool the abort failed during a cancelled turn
  sends no status, leaving Zed's own Cancelled mark in place instead of
  repainting the card Failed.
- The NO_PROXY block from `engine-entry.ts` moved to `engine/proxy.ts` and
  runs in `runAcp` too: under Bun, `fetch` honours `HTTP_PROXY`, and the
  adapter's own loopback calls would otherwise go through a corporate proxy.
- `agentInfo.version` defaults to the package `VERSION` in `run.ts`.
- `bun add` also brought `bun.lock` up to the `0.6.2` package versions that
  `package.json` already declared; no other transitive change.
- Faux-provider chunking is 12–20 characters per delta, so the streamed text
  in the sessions test is long enough to always split. The thinking-level
  test in `agent.test.ts` uses a reasoning faux model; the default one has
  a single level.
- Task 5's manual check ran against the real `auth.json`: `201` with
  `xai/grok-4.6`, then `200`, `204`, `404`. It left two transcript files in
  the default session directory for this checkout. A stdio smoke run of
  `entry.ts` (`initialize`, `session/new`, `session/close`, stdin end)
  answered with version `0.6.2`, six provider groups, and exit code 0 with
  nothing else on stdout.

---

## Required tests

Every invariant below must be covered before WP02 is called done. The tasks
add them; this list is the reviewer's checklist, not a second suite.

- a parked client request resolves with its reply, rejects on abort, and is
  gone afterwards; a reply to an unknown request is refused (Task 1);
- text reads and writes go through the client with absolute paths; images
  and paths the client does not own come from disk; a client failure is the
  tool's error, not a silent disk read; a tool's file requests carry its
  tool call id; the replacement tools keep the built-in names and prompt
  contributions (Task 2);
- a tool that is not read-only does not run until the client answers; a
  rejection fails that call only and the turn continues; `allow_always` is
  remembered for the session; reads never ask; aborting the turn releases a
  pending permission and runs nothing (Task 3);
- a prompt produces session events in the loop's order and `turn_end` is
  the last event of the turn; an edit reads and writes through the client
  attributed to its tool call; cancel ends the turn as `cancelled` and the
  session takes the next prompt; close rejects parked requests; a session
  created without client capabilities uses disk and makes no file requests
  (Task 4);
- the routes map `not_found`, `busy`, `auth_required` and `bad_request` to
  404, 409, 401 and 400; prompt answers 202 and the outcome is on the bus;
  no session response carries a credential (Task 5);
- the engine client surfaces status and code, delivers events in order, and
  reconnects after a drop, reporting the drop (Task 6);
- prompt blocks flatten to text and images; tool titles, kinds and locations
  are as specified (Task 7);
- a tool call is announced once, a rejected call keeps its status, a diffed
  call keeps its diff, a shell call gets a display-only terminal fed by
  deltas and closed with its exit code (Task 8);
- end to end through the SDK: `initialize` is version 1 with the
  capabilities Zed reads; a turn streams text, asks permission with the
  real diff, writes the editor's buffer and not the disk, sends the diff on
  the card, ends `end_turn` with a usage update; a rejection leaves the
  buffer alone; cancel answers `cancelled` and the next prompt works; a
  path outside the editor reads from disk; `set_config_option` changes the
  session; closing the connection closes the sessions on the engine
  (Task 9);
- the adapter answers `initialize` over stdio with nothing else on stdout,
  and exits when stdin closes, taking its in-process engine with it
  (Task 10);
- stock Zed: diff review, permission prompt, mid-turn cancel (Task 11).

---

## Exclusions

Do not add in this work package:

- a second agent stack, or any `AgentSession`, `ModelRuntime` or provider
  code under `packages/cli/src/engine/acp/`;
- changes under `packages/cli/src/core`, `packages/ai` or
  `packages/agent`; the operations seams and `customTools` are enough;
- `session/load`, `session/list`, `session/resume` or `session/fork`;
  transcripts persist to the CLI's session directory already, and replaying
  one as ACP updates is its own work package;
- `available_commands_update`; slash commands typed into Zed reach
  `session.prompt`, which already expands them;
- plans: no built-in tool produces one (`packages/cli/src/core/tools/` has
  eight tools and none is a task list), and OpenCode's adapter emits no
  `plan` update either; wire a `session.plan` event when something publishes
  one;
- `terminal/create` on the client: execution stays in the engine (§1.6);
- MCP servers passed in `session/new`; the field is ignored and
  `mcpCapabilities` is not advertised;
- compaction updates (`compaction_update` is unstable and needs a client
  capability Zed does not send);
- an `/events?session=` filter or a per-session stream; one bus, one
  subscriber that demultiplexes. Add the filter when a measured problem
  needs it;
- a permission policy file, per-tool settings, or an "always allow"
  that survives the session;
- extension UI bindings (`ctx.ui.*`); architecture.md §14 already lists
  this as a v1 limitation;
- `--token` on argv;
- anything in Rust.

---

## Validation

From the repository root:

```bash
bun run check-types
```

```bash
cd packages/cli && bun x vitest --run test/engine
```

Confirm the adapter holds no agent stack:

```bash
rg -n "AgentSession|createAgentSession|ModelRuntime|registerNativeProvider" packages/cli/src/engine/acp
```

Expected: no matches.

Confirm the adapter never writes a file and reads one only for a preview
the client could not give:

```bash
rg -n "writeFile|readFile" packages/cli/src/engine/acp
```

Expected: `agent.ts` only — the `readFile` import and its one use in
`readForPreview`, on the branch where the client lacks `fs.readTextFile`.

Confirm stdout is reserved for the protocol:

```bash
rg -n "process\.stdout|console\.log" packages/cli/src/engine/acp
```

Expected: `run.ts` only — the writer in `stdioStream` and the three
`console` reassignments.

Confirm the engine core is untouched and the inversion lives where it
should:

```bash
git diff --stat main -- packages/cli/src/core packages/ai packages/agent
```

Expected: no output.

```bash
rg -n "customTools|createClientFileTools" packages/cli/src
```

Expected: `sessions.ts`, `client-fs.ts`, and the pre-existing sites in
`core/sdk.ts` and `core/agent-session-services.ts` that already forward
the option. No new site under `core`.

Confirm the token never reaches argv:

```bash
rg -n "\-\-token" packages/cli/src/engine
```

Expected: no matches.

Stock Zed record (Task 11): Zed 1.19.2 stable, Windows 11 Home 10.0.26200,
2026-09-11, the adapter registered as a custom `agent_servers` entry running
`bun run packages/cli/src/engine/acp/entry.ts`, the project open at this
checkout with two throwaway files under `scratch-acp/`.

- Multi-file edit: "Rename the function greet to welcome" produced one
  permission card per file with the actual diff; after Allow the edits
  landed in the buffers under per-hunk review, and a rejected hunk reverted
  in the buffer. Saved by Zed, not the engine.
- Shell command: a card titled with the command, an embedded terminal that
  filled as the command ran, the exit status on the card. "Always allow"
  suppressed the prompt for the rest of that thread; a new thread asked
  again.
- Mid-turn cancel: Stop while streaming ended the turn with no error
  banner, the partial text stayed, and the next prompt worked. Stop while a
  permission card was showing resolved the card as cancelled and ended the
  turn.

No fix was needed; no scenario produced a commit.

---

## Stop condition

WP02 is complete when:

- stock Zed, configured with a custom `agent_servers` entry pointing at
  `packages/cli/src/engine/acp/entry.ts`, drives a full session: a
  multi-file edit arrives in Zed's buffers under per-hunk review with the
  diff shown at permission time, a shell command asks first and runs in an
  embedded terminal, and a mid-turn cancel ends the turn without an error
  and leaves the thread usable;
- `knightcode-engine acp` from source boots its own engine, and
  `--connect` attaches to a running one with the token from the
  environment;
- the engine's session routes and events exist and are the only way the
  adapter reaches a session;
- every invariant in *Required tests* has a passing test, including the
  end-to-end SDK test that shows the buffer changed and the disk did not;
- `bun run check-types` is clean and every grep in *Validation* returns
  only its expected matches;
- no file under `packages/cli/src/core`, `packages/ai` or `packages/agent`
  changed;
- the system prompt and tool definitions a session sends are the CLI's,
  byte for byte, which Task 2's prompt-contribution test and Task 4's use of
  the same factories guarantee.
