# KnightCode app server — architecture

Status: design approved in conversation 2026-10-10; spec in review
Date: 2026-10-10, revised 2026-10-11 after the IDE sunset (#313)

One long-lived process, `knightcode app-server`, hosts every KnightCode
session on the machine that a client has opened. The desktop app talks to it
over stdio; the terminal CLI runs the same server in its own process over an
in-memory transport. One protocol, one engine, every surface.

This document covers the server, its protocol, and the move of the terminal
CLI onto it. The Electron shell and its UI are a separate specification;
section 9 lists what this one binds them to.

---

## 0. Mandatory reading

Read completely before editing.

In this repository:

1. `AGENTS.md` — the 1,100-token floor, the layout table, Windows rules.

The IDE sunset (#313) deleted `packages/cli/src/engine/`. Read items 2 and 3
at `954451f04^`, for example
`git show 954451f04^:packages/cli/src/engine/sessions.ts`. Every
`engine/...` path below refers to that commit.

2. `packages/cli/src/engine/sessions.ts` — `createSessionRegistry`: many live
   `AgentSession`s in one process over one `ModelRuntime`, open
   de-duplication, cancellation, event forwarding. The thread manager grows
   out of this file.
3. `packages/cli/src/engine/permissions.ts`, `client-requests.ts`,
   `accounts.ts`, `context.ts`, `events.ts` — the permission gate as an inline
   extension, parked client requests, the login registry, the shared context.
4. `packages/cli/src/core/agent-session-runtime.ts` and
   `agent-session-services.ts` — how a session and its cwd-bound services are
   built.
5. `packages/cli/src/core/agent-session.ts:689-790` — `_beforeToolCall` and
   `_afterToolCall`, the only interception points around a tool, including
   nested calls.
6. `packages/cli/src/core/extensions/types.ts:150-301` — `ExtensionUIContext`;
   `:324-339` — `ExtensionMode` and `hasUI`.
7. `packages/cli/src/core/extensions/loader.ts:118-140,555-594` — the
   extension cache and its single-cwd key.
8. `packages/cli/src/modes/rpc/rpc-mode.ts` — how a headless mode answers
   `ExtensionUIContext` (dialogs, `setWidget`, `custom()` fallback).
9. `packages/cli/src/modes/interactive/interactive-mode.ts` — 7,107 lines;
   what section 7 migrates.
10. `packages/cli/src/core/system-prompt.ts:162-169` and
    `packages/cli/src/config.ts:507-510` — how bundled docs reach the agent.
11. `packages/tools/src/classifier-gate.ts` and
    `packages/cli/src/extensions/plan-mode/` — existing `tool_call` gates the
    approval gate must order against.
12. `scripts/build.ts:52-53` — `packages/cli/docs` is copied whole into every
    binary.

Prior art, read for structure only; no code is copied:

13. Codex `codex-rs/app-server/src/in_process.rs` — an in-memory transport
    that keeps the stdio server's request and response envelopes, so both
    paths share one contract.
14. Codex `codex-rs/app-server/src/request_processors/thread_lifecycle.rs` —
    `unload_thread_without_subscribers`: idle threads with no subscriber leave
    memory.
15. OpenCode `packages/gui-extensions/README.md` — a desktop app whose
    terminal, review and browser are extensions on one public SDK.

---

## 1. Problem

### 1.1 One process per session does not scale

An idle `knightcode --mode rpc` process measures about 285 MB of working set
on Windows (three processes, 284-286 MB each, 2026-10-10). A desktop app with
ten open threads on one process per session holds about 2.8 GB before any
conversation. The experimental client and server
(`packages/cli/src/experimental/session-worker-manager.ts`) spawn one worker
process per session and so have exactly this cost.

Most of that baseline is shared state: the model catalog, providers, the
credential store. `createSessionRegistry` already proves those can be shared:

```ts
const services = await createAgentSessionServices({
	cwd,
	agentDir,
	modelRuntime: ctx.models,   // one ModelRuntime for every session
	...
```

### 1.2 Every front door re-implements the session

Each surface that drives `AgentSession` has its own glue:

| Surface | Entry | Session glue |
| --- | --- | --- |
| TUI | `modes/interactive/interactive-mode.ts` | 186 direct `this.session.*` / `this.runtime.*` references across 73 members |
| Print | `modes/print-mode.ts` | direct |
| RPC | `modes/rpc/rpc-mode.ts` | direct, one session per process |
| IDE engine (removed in #313) | `engine/sessions.ts` | multi-session registry, HTTP and SSE |

While the engine existed, a capability added to one surface (the engine's
permission gate, plan mode in the engine, `ask_user` registration) had to be
added again to each of the others. A desktop app built as a fifth surface
would repeat that.

### 1.3 The engine's core is reusable; its front door was not

The engine spoke HTTP plus SSE to an ACP adapter process because the Zed fork
needed ACP. #313 retired the fork and deleted the whole engine. Its session
registry is the right core and is restored from `954451f04^` (section 10);
its transport, its client-backed file tools (`client-fs.ts`) and its
OpenAI-shaped completion routes are not.

---

## 2. Decisions

| Question | Decision | Rejected, and why |
| --- | --- | --- |
| Process model | One `knightcode app-server` process hosts many threads | One process per session (section 1.1: ~285 MB each); one per project (still N processes, and a thread moving between projects would cross processes) |
| Who starts it | The desktop app spawns it as a child over stdio; the terminal CLI runs it in-process | A machine-wide daemon shared by every client (lifecycle, upgrade and ownership problems with no v1 consumer; revisit when a second desktop window process needs it) |
| Wire format | JSON-RPC 2.0 shape, newline-delimited JSON, without the `"jsonrpc"` member | CBOR and chord from `packages/protocol` (couples every client to a TypeScript framework, unreadable in logs); HTTP plus SSE from the engine (two channels to correlate, and server-to-client requests need a POST-back) |
| Protocol home | New private package `@knightcode/app-server-protocol`, TypeBox schemas, imports nothing from `@knightcode/ai` or `@knightcode/agent` | Types inside `packages/cli` (the Electron renderer would import the harness to get a type) |
| Base | The engine's `createSessionRegistry`, restored from `954451f04^` into `packages/cli/src/app-server/`, becomes the thread manager | A new registry (re-solves open de-duplication, cancellation and shutdown order the engine already got right); the experimental durable server (a separate runtime, not `AgentSession`) |
| In-process transport | Same envelopes as stdio, passed as objects through bounded queues | Direct method calls for the TUI (two contracts; the point of the migration is one) |
| Approvals | A hidden inline extension per thread, generalised from `engine/permissions.ts`, with three modes | A new hook in `AgentSession` (core change with no need: `tool_call` already blocks); an OS sandbox (v1 cost on three platforms, Windows alone is a project) |
| Live-session ownership | `proper-lockfile` lock on the session file while a thread is loaded | No lock (a desktop app and a terminal CLI resuming one thread would both append to one JSONL file) |
| Idle memory | Unload a thread idle 10 minutes with no subscriber | Keep every opened thread live (memory grows with every click in the sidebar) |
| Extension module state | Cache keyed by `(cwd, path)`; module-level state is shared per process and documented as such | One module instance per session (`moduleCache: false` already re-evaluates on load; per-session evaluation multiplies memory by thread count) |
| Terminal-only extension UI | Over the in-process transport a request may carry a `localHandle` to a live component; over stdio it degrades | Serialising TUI components (impossible: they hold closures and the TUI instance); dropping them (breaks existing extensions in the terminal) |
| RPC mode | Kept unchanged beside the app server | Removal (user decision 2026-10-10); reimplementing it on the app server (two protocols to keep in step) |
| Extension mode | A new `ExtensionMode` value `"desktop"` for threads a stdio client starts; threads the in-process terminal client starts keep `"tui"`. `hasUI` is true while a subscriber answers `ui/dialog` | Reusing `"rpc"` (built-in extensions that branch on `ctx.mode`, such as plan mode and MCP, could not tell a desktop window from a headless pipe); one `"appServer"` value for both clients (the terminal's `"tui"` branches would stop running after Phase D) |
| Spec home | `apps/desktop/docs/desktop-app/` | `packages/cli/docs/` (copied into every binary by `scripts/build.ts:52-53`) |

---

## 3. Terminology and ownership

```text
App server   knightcode app-server. Headless. Threads, turns, items,
             approvals, accounts, models, workspaces, git.
Client       anything that speaks the protocol: the desktop app (stdio),
             the terminal CLI (in-process), tests (both).
Thread       one KnightCode session file. Thread id = session id.
Turn         one user prompt through to the agent settling: from the
             session's agent_start to agent_settled. Not the agent loop's
             per-model-call turn_start/turn_end.
Item         one thing that happened inside a turn: a message, a reasoning
             block, a tool call, a file change, a compaction.
```

### App server

Owns:

- every `AgentSession`, its lock, its lifetime;
- the shared `ModelRuntime` and credential store;
- the approval gate and its per-thread mode;
- worktree creation, diffs, git operations;
- the mapping from session events to turns and items.

The app server knows nothing about pixels or keys.

### Client

Owns:

- every pixel and keystroke;
- which threads are on screen, and therefore which it subscribes to;
- answering server requests (approvals, dialogs).

A client never constructs an `AgentSession`. After section 7 lands, that
includes the terminal CLI.

---

## 4. Protocol

### 4.1 Envelopes and handshake

```ts
type RequestId = string | number;

interface Request<M extends string, P> { id: RequestId; method: M; params: P }
interface Notification<M extends string, P> { method: M; params: P }
type Response<R> =
	| { id: RequestId; result: R }
	| { id: RequestId; error: { code: ErrorCode; message: string; data?: unknown } };

type ErrorCode =
	| "invalidParams" | "methodNotFound" | "notInitialized" | "versionMismatch"
	| "threadNotFound" | "threadLockedElsewhere" | "turnInProgress"
	| "authRequired" | "gitConflict" | "toolMissing" | "internal";
```

Both directions carry requests: the server sends `item/toolCall/requestApproval`
and `ui/dialog` as requests and waits for the client's response.

The first client message must be `initialize`:

```ts
interface InitializeParams {
	clientInfo: { name: string; version: string };
	protocolVersion: number;
	capabilities: { localHandles?: boolean }; // true only on the in-process transport
}
interface InitializeResult {
	serverInfo: { name: "knightcode"; version: string };
	protocolVersion: number;
}
```

A different `protocolVersion` answers `versionMismatch` and closes the
connection. The client then sends the `initialized` notification. Any other
method before that answers `notInitialized`.

### 4.2 Data types

```ts
interface Thread {
	id: string;
	cwd: string;
	name: string;               // session name, or first line of the first message
	status: "notLoaded" | "idle" | "active";
	updatedAt: string;          // ISO 8601
	workspace: { mode: "local" } | { mode: "worktree"; path: string; branch: string; baseRef: string };
	approvalMode: ApprovalMode;
	model?: ModelRef;
	thinkingLevel: ThinkingLevel;
}

interface Turn {
	id: string;
	threadId: string;
	status: "inProgress" | "completed" | "interrupted" | "failed";
	error?: string;
	items: Item[];              // filled on thread/read; empty on turn/started
}

type Item =
	| { type: "userMessage"; id: string; text: string; images: ImageRef[] }
	| { type: "agentMessage"; id: string; text: string }
	| { type: "reasoning"; id: string; text: string }
	| { type: "toolCall"; id: string; tool: string; input: unknown;
	    status: "pending" | "running" | "completed" | "failed" | "declined";
	    output: ToolOutput[]; view?: View }
	| { type: "fileChange"; id: string; changes: { path: string; kind: "add" | "modify" | "delete" }[] }
	| { type: "compaction"; id: string; summary: string }
	| { type: "extensionMessage"; id: string; extension: string; text: string; view?: View };

type ApprovalMode = "ask" | "autoEdit" | "fullAccess";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
interface ModelRef { provider: string; id: string; name: string; contextWindow: number }
type ToolOutput = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string };
```

`ThinkingLevel` mirrors `@knightcode/agent` by value. A protocol test asserts
the two unions are equal so they cannot drift.

`View` is section 8.2.

### 4.3 Event mapping

`ItemMapper` subscribes to one session and emits notifications:

| Session event | Notification |
| --- | --- |
| `agent_start` | `turn/started` |
| `message_start` (user) | `item/started` + `item/completed` `userMessage` |
| `message_start` (assistant) | `item/started` `agentMessage` |
| `message_update` `text_delta` | `item/agentMessage/delta` |
| `message_update` `thinking_delta` | `item/reasoning/delta` (a `reasoning` item starts on its first delta) |
| `message_end` (assistant) | `item/completed` for its message and reasoning items |
| `tool_execution_start` | `item/started` `toolCall`, `running` |
| `tool_execution_update` | `item/toolCall/outputDelta` |
| `tool_execution_end` | `item/completed` `toolCall`; plus a `fileChange` item for `edit` and `write` |
| `compaction_start` / `compaction_end` | `item/started` / `item/completed` `compaction` |
| `auto_retry_start` / `auto_retry_end` | `turn/retry` with attempt and delay |
| `queue_update` | `turn/queue/updated` (steer and follow-up queues) |
| `session_info_changed` | `thread/name/updated` |
| `thinking_level_changed` | `thread/settings/updated` |
| `agent_settled` | `turn/completed`, then `turn/diff/updated` when the turn changed files |

`agent_end` is not mapped: a turn ends when the session settles, after queued
follow-ups. The engine's `forward()` (`sessions.ts:250-312`) and its
`stopReasonOf` are the starting point; `turn/completed` carries the same
`completed | interrupted | failed` classification, with the engine's rule that
the cancelled flag wins over the last message's stop reason.

### 4.4 Methods

Client to server. Grouped by phase (section 10); every method listed is in
scope for this specification.

Phase A:

| Method | Params → result |
| --- | --- |
| `thread/start` | `{cwd, workspace?, approvalMode?, model?, thinkingLevel?}` → `{thread}` |
| `thread/resume` | `{threadId}` → `{thread, turns}`; subscribes the connection |
| `thread/fork` | `{threadId, atItemId?}` → `{thread}` |
| `thread/list` | `{cwd?, cursor?, archived?}` → `{threads, nextCursor?}` |
| `thread/read` | `{threadId, cursor?}` → `{thread, turns, nextCursor?}`; does not load or subscribe |
| `thread/unsubscribe` | `{threadId}` → `{}` |
| `thread/archive` / `thread/unarchive` | `{threadId}` → `{}` |
| `thread/name/set` | `{threadId, name}` → `{}` |
| `thread/settings/update` | `{threadId, model?, thinkingLevel?, approvalMode?}` → `{thread}` |
| `thread/compact` | `{threadId, instructions?}` → `{}` |
| `turn/start` | `{threadId, text, images?}` → `{turn}`; `turnInProgress` if one runs |
| `turn/steer` | `{threadId, text, images?}` → `{}` |
| `turn/followUp` | `{threadId, text, images?}` → `{}` |
| `turn/interrupt` | `{threadId}` → `{}` |
| `model/list` | `{}` → `{models}` |
| `command/list` | `{threadId}` → `{commands}` (extension commands, prompt templates, skills, as `commandsOf` builds them) |
| `config/read` | `{cwd?}` → effective settings |
| `account/list` | `{}` → `{accounts}` |
| `account/login/start` | `{provider}` → `{loginId}`; progress as `account/login/updated` |
| `account/login/answer` | `{loginId, value}` → `{}` |
| `account/logout` | `{provider}` → `{}` |

Phase B: section 6. Phase C: section 8. Phase D adds the terminal's remaining
needs (section 7.2).

Server to client notifications: `thread/started`, `thread/replaced`,
`thread/status/changed`,
`thread/name/updated`, `thread/settings/updated`, `thread/archived`,
`turn/started`, `turn/completed`, `turn/retry`, `turn/queue/updated`,
`turn/diff/updated`, `item/started`, `item/completed`,
`item/agentMessage/delta`, `item/reasoning/delta`,
`item/toolCall/outputDelta`, `account/login/updated`, `account/updated`,
`error`.

Server to client requests: `item/toolCall/requestApproval` (section 5.4),
`ui/dialog` (section 8.1).

### 4.5 Subscriptions

A connection is subscribed to a thread after `thread/start`, `thread/resume`
or `thread/fork` on it, and stops after `thread/unsubscribe` or disconnect.
Thread-scoped notifications go only to subscribers. `thread/list` and
`thread/read` never subscribe.

A server request goes to one subscriber: the one that most recently started a
turn on that thread. If it disconnects, the request moves to the next
subscriber; with none left it resolves as cancelled, and the tool call is
blocked with "Tool call cancelled", as `permissions.ts` did.

An extension command that replaces the session (`ctx.newSession`, `ctx.fork`,
`ctx.switchSession`; plan mode's "Implement in a fresh session" is one) loads
the target as a thread, moves every subscription from the old thread to it,
and sends `thread/replaced {oldThreadId, thread}`. The old thread then follows
section 5.6 like any thread without subscribers.

---

## 5. Server internals

### 5.1 Layout

`packages/cli/src/app-server/`:

| File | Owns |
| --- | --- |
| `server.ts` | `AppServer`: one per connection. Handshake, dispatch, outgoing request table, notification fan-out. Transport-agnostic |
| `transport.ts` | `Transport` interface: `send(message)`, `onMessage`, `close` |
| `stdio.ts` | ndjson over stdin and stdout; stderr for logs |
| `in-process.ts` | paired bounded queues; `createInProcessClient()` |
| `threads.ts` | `ThreadManager`: `Map<threadId, LoadedThread>`, load, unload, subscribers, idle timer. Moved and generalised from `engine/sessions.ts` |
| `loaded-thread.ts` | `LoadedThread`: one session, its lock, its mapper, its approval mode |
| `item-mapper.ts` | section 4.3 |
| `approvals.ts` | section 5.4; moved from `engine/permissions.ts` |
| `accounts.ts`, `models.ts` | moved from `engine/`, routes replaced by method handlers |
| `workspaces.ts`, `git.ts`, `diff.ts` | section 6 |
| `entry.ts` | `knightcode app-server` subcommand |

`packages/app-server-protocol/src/`: `protocol.ts` (envelopes, methods,
notifications, requests as TypeBox schemas plus `Static` types), `view.ts`
(section 8.2), `index.ts`. `scripts/generate-schema.ts` writes
`packages/cli/docs/app-server.schema.json`.

### 5.2 What is shared and what is per thread

Per process, in `AppServerContext` (the engine's `EngineContext`, renamed):
one `ModelRuntime`, one `AuthStorage`, one event bus, global `SettingsManager`.

Per thread: `SettingsManager` for its cwd, `ResourceLoader`, `AgentSession`.
These cannot be shared between threads of one project: `createAgentSession`
binds the resource loader's extension runtime to one session.

The engine's client-backed file tools (`createClientFileTools`) are not restored.
The app server's tools write to disk, as the CLI's do.

### 5.3 Extension isolation

`loader.ts:118-139` clears the whole extension cache whenever a load names a
different cwd:

```ts
function useExtensionCacheCwd(cwd: string): ExtensionCacheToken {
	const resolvedCwd = resolvePath(cwd);
	if (extensionCacheCwd !== undefined && extensionCacheCwd !== resolvedCwd) {
		clearExtensionCache();
	}
```

Two threads in two projects evict each other on every load. The cache key
becomes `(resolved cwd, extension path)`; `clearExtensionCache()` keeps its
meaning (clear all) for `/reload`.

Factories already run once per session. Module-level variables in an
extension are shared by every session in the process that loads it.
`docs/extensions.md` gains a paragraph under State saying so, and that
per-session state belongs in the factory closure.

### 5.4 Approvals

`approvals.ts` registers one hidden inline extension per thread, as
`createPermissionExtension` does, ordered after plan mode and the classifier
gate so that their blocks win:

| Mode | Asks before |
| --- | --- |
| `ask` | every tool not in the read-only set |
| `autoEdit` | `bash`, `powershell`, and any tool not in the read-only or edit sets |
| `fullAccess` | nothing |

Read-only set: `read`, `grep`, `find`, `ls`, `ask_user`, `submit_plan` (the
engine's `READ_ONLY_TOOLS`). Edit set: `edit`, `write`. Extension tools count
as neither, so `ask` and `autoEdit` both ask for them.

```ts
interface ToolCallApprovalParams {
	threadId: string; turnId: string; itemId: string;
	tool: string; input: unknown; parentItemId?: string;
}
interface ToolCallApprovalResult {
	decision: "accept" | "acceptForSession" | "decline" | "cancel";
}
```

`acceptForSession` adds the tool name to the thread's allow set until the
thread unloads, as the engine's `allow_always` did. The mode is persisted as a
custom session entry so a resumed thread keeps it. Default: `ask` for a thread
the desktop app starts, `fullAccess` for one the terminal CLI starts, which is
today's terminal behaviour.

Nested calls (code mode) reach the gate through `_beforeToolCall`'s
`parentToolCallId` and carry `parentItemId`.

### 5.5 Session lock

`LoadedThread` takes a `proper-lockfile` lock on the session file when it
loads and releases it when it unloads, with `stale` and `update` set so a
crashed holder's lock goes stale. A load that finds the lock held answers
`threadLockedElsewhere`; `thread/read` still works, as it needs no lock. An
in-memory thread (tests, `--no-session`) takes no lock.

### 5.6 Memory

A thread with no subscriber and no running turn starts a 10-minute timer.
When it fires: release pending requests as cancelled, `session.abort()`,
`session_shutdown` with reason `quit`, `dispose()`, release the lock, status
`notLoaded`. This is the engine's `close()` order (`sessions.ts:325-339`).
`turn/start` or `thread/resume` on a `notLoaded` thread loads it again.

### 5.7 Turns

`turn/start` calls `session.prompt()` with the engine's preflight pattern
(`sessions.ts:531-561`): the request resolves once preflight passes, and the
outcome is `turn/completed`. `turn/steer` and `turn/followUp` call the
session's queues. `turn/interrupt` sets the cancelled flag, aborts pending
client requests, and calls `session.abort()`.

---

## 6. Workspaces, diffs and git

### 6.1 Worktree or local

`thread/start` takes `workspace`:

- `{mode: "local"}`: the thread runs in `cwd`.
- `{mode: "worktree", baseRef?}`: `git worktree add -b kc/<slug> <path>
  <baseRef ?? HEAD>` into `<agentDir>/worktrees/<project-hash>/<threadId>`.
  `<slug>` is the thread id's first 8 characters until the thread is named.
  The thread's cwd is the worktree; `Thread.workspace` records path, branch
  and base.

`thread/worktree/handoff {threadId, strategy: "merge" | "apply"}`:

- `merge`: commit pending worktree changes if any (message from section 6.3),
  then `git merge --no-ff kc/<slug>` in the main checkout.
- `apply`: `git diff <baseRef>...` from the worktree applied with
  `git apply --3way` in the main checkout, uncommitted.

Either stops on conflict and answers `gitConflict` with the conflicting paths.
It never resolves a conflict and never discards changes in the main checkout.

`thread/archive` on a worktree thread removes the worktree only when it has
no uncommitted changes; otherwise it archives and keeps the worktree, and says
so in the result. Worktrees the app server did not create are never touched.

### 6.2 Diffs

| Method | Behaviour |
| --- | --- |
| `thread/diff/read {threadId}` | working tree against base (`HEAD` for local, `baseRef` for worktree): files, hunks, line ranges, binary flag |
| `thread/diff/revert {threadId, path, hunk?}` | reverse-applies one hunk or restores one file |
| `thread/diff/comment {threadId, comments}` | composes one follow-up message quoting each comment's anchored lines, then behaves as `turn/followUp` |

`turn/diff/updated {threadId, turnId, files}` follows `turn/completed` when the
turn changed files.

### 6.3 Git

`git/stage`, `git/unstage` (`{threadId, path, hunk?}`), `git/commit
{threadId, message?}`, `git/push {threadId}`, `git/pr/create {threadId,
title?, body?}`.

An empty commit message asks the thread's model for one from the staged diff,
outside the conversation. `git/pr/create` runs `gh pr create`; without `gh`
on PATH it answers `toolMissing`.

Every git call is `spawn("git", args, {cwd})` with an argument array. No
shell strings, so quoting is identical on Windows.

---

## 7. The terminal CLI on the app server

### 7.1 Slices

`InteractiveMode` gets an `AppServerClient` over the in-process transport.
Each slice replaces direct session access with protocol calls and leaves the
CLI working:

1. Turn lifecycle and transcript: `prompt`, `steer`, `followUp`, `abort`,
   and rendering from items instead of session events.
2. Model, thinking level, scoped models, settings.
3. Session tree: navigate, fork, clone, compact, rename, export, import,
   new, resume.
4. `!` bash, slash commands, prompt templates, context usage, retry, cache
   warming.
5. Extension UI (section 8).

Print mode moves in slice 1.

Done means: `rg -n "AgentSession\b|AgentSessionRuntime\b"
packages/cli/src/modes/interactive packages/cli/src/modes/print-mode.ts`
matches imports of protocol types only.

### 7.2 Methods the terminal adds

Added as their slice needs them, each documented in section 4.4's table when
it lands: `thread/tree/read`, `thread/tree/navigate`, `thread/clone`,
`thread/export`, `thread/import`, `thread/settings/update` fields for scoped
models, steering mode, follow-up mode, auto-compaction, auto-retry and cache
warming, `turn/queue/clear`, `turn/retry/abort`, `shell/exec` and
`shell/abort` for `!` commands, `thread/contextUsage/read`,
`thread/stats/read`.

### 7.3 Local handles

`ExtensionUIContext` calls that take a component factory (`setWidget` with a
factory, `setHeader`, `setFooter`, `custom`, `onTerminalInput`) cannot cross
a process boundary. When the connection's `initialize` declared
`capabilities.localHandles`, the server sends them as `ui/local` requests
carrying an opaque `localHandle`; `in-process.ts` resolves the handle to the
live factory, and the TUI renders it as today. On stdio, these calls behave as
RPC mode's do (`rpc-mode.ts:160-240`). This is the only difference between
the two transports, and `in-process.ts` is the only file that resolves a
handle.

### 7.4 Divergence

After Phase D, `interactive-mode.ts` drives an `AppServerClient` instead of a
session. Changes to interactive mode written against the old shape are
translated by hand from then on. Accepted 2026-10-10.

---

## 8. Extension UI over the protocol

### 8.1 Today's API

| `ExtensionUIContext` | Protocol | Desktop | Terminal |
| --- | --- | --- | --- |
| `select`, `confirm`, `input`, `editor` | request `ui/dialog` | native dialog | as today |
| `notify` | notification `ui/notify` | toast | as today |
| `setStatus`, `setTitle`, `setWorkingMessage`, `setWorkingVisible`, `setHiddenThinkingLabel` | notification `ui/state` | status bar, title, working text | as today |
| `setWidget(key, string[])` | notification `ui/widget` with lines | panel above the composer | as today |
| `setWidget(key, view)` (new) | notification `ui/widget` with a view | native rendering | `ViewComponent` |
| factory forms, `custom`, `onTerminalInput`, `setWorkingIndicator` | `ui/local` (section 7.3) | logged once per extension: "terminal-only UI" | as today |

All `ui/*` messages carry `threadId` and the extension's name.

### 8.2 Declarative views

```ts
type View =
	| { type: "text"; text: string; tone?: "muted" | "accent" | "success" | "warning" | "error" }
	| { type: "markdown"; markdown: string }
	| { type: "stack"; direction?: "vertical" | "horizontal"; children: View[] }
	| { type: "list"; items: View[] }
	| { type: "table"; columns: string[]; rows: string[][] }
	| { type: "progress"; value: number; max: number; label?: string }
	| { type: "button"; id: string; label: string }
	| { type: "field"; id: string; kind: "text" | "toggle" | "select"; label: string;
	    value: string | boolean; options?: string[] };
```

A `button` press or `field` change is a client notification `ui/event
{threadId, extension, widgetKey, id, value?}`; the extension receives it
through a new `ctx.ui.onViewEvent(handler)`. No arbitrary HTML, no scripts, no
URLs that load: a view is data.

`packages/cli/src/modes/interactive/components/view-component.ts` renders a
`View` with existing TUI components, so one extension draws in both clients.

A tool result may set `details.view`; the item carries it as `view`, and the
desktop transcript renders it in place of raw output, as terminal tool
renderers do today.

### 8.3 Docs the agent reads

The binary already ships `packages/cli/docs`, and the system prompt names
which file answers which topic (`system-prompt.ts:167`). Added docs:

- `docs/desktop.md` — index: what the desktop app is, and links to the rest.
- `docs/app-server.md` — protocol reference, linking
  `docs/app-server.schema.json` (generated).
- `docs/declarative-views.md` — the `View` vocabulary and `onViewEvent`.
- `docs/desktop-extensions.md` — the GUI extension SDK (written with the
  desktop spec; this spec reserves the name).
- `examples/extensions/desktop-view.ts` — a widget and a tool result using a
  view.

Line 167 gains one entry, `desktop app and its extensions (docs/desktop.md)`.
Required tests pin its token cost.

---

## 9. Requirements on the desktop specification

The Electron shell and UI are specified separately. That specification must:

- Bundle the platform `knightcode` binary outside `app.asar` in the app's
  resources directory, and spawn `knightcode app-server` from there. Never a
  `knightcode` found on PATH. Write the binary's version to a file beside it
  at build time so launch does not spawn the binary to ask.
- Keep the renderer without Node access. The main process owns the child and
  relays protocol messages to the renderer over a `MessagePort`.
- Restart the app server with backoff when it exits, then `thread/resume`
  every thread on screen. A turn that was running shows `interrupted`.
- Treat the integrated terminal, the diff review pane and the web view as GUI
  extensions built on the same public SDK that third-party GUI extensions use.
- Let one KnightCode package carry an agent extension and a GUI extension:
  a `desktop` resource type beside `extensions`, `skills`, `prompts` and
  `themes` in `package-manager.ts:208-210`.
- Gate project-local GUI extensions with the existing project trust.
- Theme through CSS tokens loaded from theme files; no colours in components.
- Bind keys through a configurable keybinding table; no hardcoded key checks.
- Leave agent control of the web view to a later specification, but host the
  view in a `WebContentsView` whose `webContents.debugger` can be attached
  later.

---

## 10. Implementation phases and file manifest

Each phase is one work package and its own implementation plan.

### Prerequisite — IDE retirement (done)

#313 (`954451f04`, merged 2026-10-11) removed the `apps/desktop/ide`
submodule, all of `packages/cli/src/engine/` and its tests,
`engine-entry.ts`, the `--engine` build target, the ACP SDK, the
`"engine"` extension mode, and the IDE's docs and website pages. The
`knightcode-ide` repository is deleted.

Phase A restores the modules this spec reuses (`sessions.ts`,
`permissions.ts`, `client-requests.ts`, `accounts.ts`, `models.ts`,
`events.ts`, `context.ts`) from `954451f04^` and adapts them. Where this spec
says a file is "moved from `engine/`", it means restored from that commit.
The rest of the engine stays deleted.

### Phase A — app server core

- New `packages/app-server-protocol/` (`package.json`, `src/protocol.ts`,
  `src/index.ts`, `test/`), root `tsconfig.json` path mapping, AGENTS.md
  layout table row.
- `packages/cli/src/app-server/`: every file in section 5.1 except
  `workspaces.ts`, `git.ts`, `diff.ts`.
- `packages/cli/src/core/extensions/loader.ts`: `(cwd, path)` cache key.
- `packages/cli/src/core/extensions/types.ts`: `"desktop"` in `ExtensionMode`;
  built-in extensions that branch on `ctx.mode` (`plan-mode`, `mcp`, `ui`,
  `llama`, `undo`) get a `"desktop"` branch where `"rpc"` behaviour would be
  wrong.
- `packages/cli/src/main.ts` / `cli/args.ts`: `app-server` subcommand.
- `packages/cli/docs/app-server.md`, `app-server.schema.json`,
  `extensions.md` (State paragraph), `cli.md` (subcommand).
- Changeset: `Added`.

### Phase B — workspaces, diffs, git

- `packages/cli/src/app-server/workspaces.ts`, `diff.ts`, `git.ts`; methods
  of section 6 in `protocol.ts`.
- Docs: `app-server.md`.
- Changeset: `Added`.

### Phase C — extension UI over the protocol

- `protocol.ts`: `ui/*` messages; `view.ts`.
- `packages/cli/src/core/extensions/types.ts`: `setWidget` overload taking a
  `View`, `onViewEvent`.
- `packages/cli/src/modes/interactive/components/view-component.ts`.
- `docs/desktop.md`, `declarative-views.md`, `examples/extensions/desktop-view.ts`,
  `system-prompt.ts:167` entry.
- Changeset: `Added`.

### Phase D — terminal CLI migration

- `packages/cli/src/modes/interactive/`, `print-mode.ts`: slices 1-5 of
  section 7.1, one or more PRs per slice.
- `packages/cli/src/app-server/in-process.ts`: local handles.
- Protocol additions of section 7.2.
- Changeset per slice only where behaviour visible to users changes.

---

## 11. Required tests

Protocol (`packages/app-server-protocol/test/`):

- Every method, notification and request schema accepts a valid example and
  rejects a missing required field and an unknown member.
- `ThinkingLevel` in the protocol equals `@knightcode/agent`'s union.
- The generated JSON Schema is up to date (regenerating produces no diff).

Server (`packages/cli/test/suite/app-server/`, faux provider, in-process
transport unless stated):

- A method before `initialize` answers `notInitialized`; a wrong
  `protocolVersion` answers `versionMismatch`.
- `thread/start` then `turn/start` emits, in order: `turn/started`,
  `item/started` `userMessage`, `item/completed` `userMessage`,
  `item/started` `agentMessage`, at least one `item/agentMessage/delta`,
  `item/completed`, `turn/completed` `completed`.
- A tool-calling faux reply produces `toolCall` items with `running` then
  `completed`, and `edit` adds a `fileChange` item and `turn/diff/updated`.
- Two threads in two cwds run turns concurrently; each subscriber receives
  only its thread's notifications.
- Two connections resuming one thread on one server share one live session;
  two servers (two `ThreadManager`s over one session dir) get
  `threadLockedElsewhere` on the second, and `thread/read` still succeeds.
- A thread with no subscriber unloads after the idle timeout (fake timers),
  releases its lock, and reloads on `turn/start` with its transcript intact.
- `turn/start` during a running turn answers `turnInProgress`;
  `turn/interrupt` yields `turn/completed` `interrupted`.
- Approvals: `ask` requests approval for `bash`, `edit`, and an extension
  tool, not for `read`; `autoEdit` requests for `bash` only;
  `fullAccess` never; `decline` blocks with "The user rejected this tool
  call"; `acceptForSession` stops later requests for that tool; the mode
  survives unload and resume; a disconnect with no other subscriber cancels
  the request and blocks the call.
- Approval ordering: a plan-mode block wins over an approval request (no
  request is sent).
- Extension cache: loading extensions for cwd B does not evict cwd A's
  entries.
- Extension mode: an extension sees `ctx.mode` `"desktop"` in a thread a
  stdio client started and `"tui"` in one the in-process terminal client
  started.
- Session replacement: an extension command calling `ctx.newSession()` sends
  `thread/replaced` to every subscriber of the old thread, and the next
  `turn/start` on the new thread id succeeds.
- `ui/dialog` round-trips select, confirm, input and editor; `ui/widget`
  with lines and with a view reaches the subscriber; a factory widget over a
  connection without `localHandles` behaves as RPC mode does.
- Worktrees (temporary git repo): create, turn edits a file, handoff `apply`
  leaves the change uncommitted in the main checkout; handoff `merge` merges
  the branch; a conflicting handoff answers `gitConflict` with paths and
  leaves the main checkout unchanged; archive refuses to delete a worktree
  with uncommitted changes.
- `git/pr/create` with no `gh` on PATH answers `toolMissing`.
- One stdio test spawns `bun src/cli.ts app-server`, completes a handshake,
  starts a thread with the faux provider, and reads `turn/completed`.

Terminal CLI:

- The existing interactive and print tests pass after every slice.
- Each slice adds suite tests for the methods it introduced.

Docs:

- The system-prompt docs section grows by at most 15 tokens.

---

## 12. Exclusions

Do not add:

- A machine-wide daemon, a WebSocket transport, or remote connections.
- An OS-level sandbox.
- Automations, scheduled runs, or cloud tasks.
- Agent control of the web view.
- Any change to RPC mode.
- HTML, scripts or loadable URLs in `View`.
- A second registry beside `ThreadManager`, or any use of the experimental
  durable server.
- System-prompt text beyond the one docs entry in section 8.3.
- Backward compatibility with the engine's HTTP routes.

---

## 13. Validation

From the repo root:

- `bun run check-types`
- `cd packages/app-server-protocol && bun x vitest --run`
- `cd packages/cli && bun x vitest --run test/suite/app-server/`
- `bun x prettier --check "packages/app-server-protocol/**/*.ts" "packages/cli/src/app-server/**/*.ts"`
- `bun run scripts/changelog-sections.ts`
- `rg -n "from \"@knightcode/(ai|agent)\"" packages/app-server-protocol/src`
  → no matches.
- `rg -n "exec\(|execSync\(|shell: true" packages/cli/src/app-server` → no
  matches.
- After Phase D: `rg -n "AgentSession\b|AgentSessionRuntime\b"
  packages/cli/src/modes/interactive packages/cli/src/modes/print-mode.ts`
  → type imports from the protocol only.
- Memory: start `knightcode app-server`, open ten threads over stdio with a
  script, and record working set. Phase A records the measured per-thread
  figure in this document; there is no target until it is measured.
- Manual: `bun run start` works end to end after each Phase D slice: prompt,
  tool call, `/model`, `/tree`, `/fork`, `!ls`, an extension dialog, an
  extension `ctx.ui.custom` component.

---

## 14. Stop condition

The app server is complete when:

- `knightcode app-server` speaks the protocol of section 4 over stdio, and
  `createInProcessClient()` speaks it in-process.
- One process runs many threads concurrently over one `ModelRuntime`, locks
  each live session file, and unloads idle threads.
- Approvals work in all three modes, after plan mode and the classifier gate.
- Worktree threads can be created, handed off and archived without losing
  changes.
- Extensions show dialogs, notifications, status, line widgets and view
  widgets over both transports, and factory UI in the terminal.
- The terminal CLI and print mode construct no `AgentSession` of their own.
- The required tests pass, `bun run check-types` is clean, and every
  validation grep matches as stated.
