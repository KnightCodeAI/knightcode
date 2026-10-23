# KnightCode app server — architecture

Status: design approved in conversation 2026-10-10; spec in review
Date: 2026-10-10, revised 2026-10-11 after the IDE sunset (#313), a gap review
and a design review (turn identity, shared model runtime, lock contract,
thread lifecycle, snapshots, transport limits, Phase B git safety), followed
by an implementation-risk review (canonical ownership, replacement
cancellation, bounded history, start outcomes, listing and memory costs);
revised 2026-10-13 (section 4.6) after a study of the Codex desktop app's
protocol and UI, alongside the new [desktop-shell.md](./desktop-shell.md);
revised 2026-10-15 to keep the server above the harness (section 4.7): the
queue, error kinds and settings writes moved out of `packages/agent`,
`packages/ai` and `AgentSession`, and the protocol lost its version number

One long-lived process, `knightcode app-server`, hosts every KnightCode
session on the machine that a client has opened. The desktop app talks to it
over stdio; the terminal CLI runs the same server in its own process over an
in-memory transport. One protocol, one engine, every surface.

This document covers the server, its protocol, and the move of the terminal
CLI onto it. The Electron shell and its UI are specified in
[desktop-shell.md](./desktop-shell.md); section 9 lists what this one binds
them to.

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
7. `packages/cli/src/core/extensions/loader.ts:127-140,555-594` — the
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
16. The Codex desktop app's bundled app server (`codex app-server
    generate-ts`, codex-cli 0.162) — the protocol a shipped multi-thread
    desktop client actually uses. Section 4.6 lists what this protocol adopts
    from it, what it adapts, and what it deliberately leaves out. Its source
    (`shenanigans/codex`, `codex-rs/app-server`, `codex-rs/ext/queue`) shows
    where Codex puts each feature relative to its core.

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
| Live-session ownership | `proper-lockfile` lock on the session file while a thread is loaded; a closed manager or one whose lock was taken over rejects writes (section 5.5) | No lock (a desktop app and a terminal CLI resuming one thread would both append to one JSONL file) |
| Shared model runtime | One `ModelRuntime` per process; virtual-model routes are owned by the session that registered them (section 5.2) | One `ModelRuntime` per thread (duplicates the catalog and auth state per thread); one shared route per virtual model (thread B's load rebinds thread A's router to B's extension context) |
| Turn identity | A turn is one agent run, from the first `agent_start` to `agent_settled`, recorded by start and end entries in the session file (section 4.2) | Every `agent_start` as a turn (a retry or follow-up restarts the agent inside one run); entry ids of messages (unknown when the live event fires) |
| Idle memory | Unload a thread idle 10 minutes with no subscriber | Keep every opened thread live (memory grows with every click in the sidebar) |
| Extension module state | Cache keyed by `(cwd, path)`; module-level state is shared per process and documented as such | One module instance per session (`moduleCache: false` already re-evaluates on load; per-session evaluation multiplies memory by thread count) |
| Terminal-only extension UI | Over the in-process transport a request may carry a `localHandle` to a live component; over stdio it degrades | Serialising TUI components (impossible: they hold closures and the TUI instance); dropping them (breaks existing extensions in the terminal) |
| RPC mode | Kept unchanged beside the app server | Removal (user decision 2026-10-10); reimplementing it on the app server (two protocols to keep in step) |
| Extension mode | A new `ExtensionMode` value `"desktop"` for threads a stdio client starts; threads the in-process terminal client starts keep `"tui"`. `hasUI` is true while a subscriber answers `ui/dialog`, so false for desktop threads until Phase C | Reusing `"rpc"` (built-in extensions that branch on `ctx.mode`, such as plan mode and MCP, could not tell a desktop window from a headless pipe); one `"appServer"` value for both clients (the terminal's `"tui"` branches would stop running after Phase D) |
| Spec home | `apps/desktop/docs/desktop-app/` | `packages/cli/docs/` (copied into every binary by `scripts/build.ts:52-53`) |

---

## 3. Terminology and ownership

```text
App server   knightcode app-server. Headless. Threads, turns, items,
             approvals, accounts, models, workspaces, git.
Client       anything that speaks the protocol: the desktop app (stdio),
             the terminal CLI (in-process), tests (both).
Thread       one KnightCode session file. Thread id = session id.
Turn         one agent run: from the run's first agent_start to its
             agent_settled. A retry, a follow-up or overflow recovery
             restarts the agent (another agent_start) inside the same
             turn. Not the agent loop's per-model-call turn_start/turn_end.
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
	| "invalidParams" | "methodNotFound" | "notInitialized"
	| "threadNotFound" | "threadLockedElsewhere" | "turnInProgress"
	| "invalidCursor" | "payloadNotFound" | "archiveConflict"
	| "authRequired" | "gitConflict" | "notGitRepo" | "toolMissing"
	| "turnMismatch" | "configConflict" | "threadNotArchived"
	| "shuttingDown" | "internal";
```

`turnMismatch` answers a steer or interrupt whose `expectedTurnId` or `turnId`
names a turn that is not the running one (section 4.4).
`configConflict` answers a `config/write` whose `expectedVersion` is stale.
`threadNotArchived` answers `thread/delete` on a thread that is not archived.

String envelope request ids are limited to 128 Unicode code points. History
paging reserves 1,024 bytes for the envelope/id, including JSON escaping,
inside its 1 MiB response budget. A supplied turn-start correlation token is
nonempty, at most 128 code points, and globally unique among overlapping
requests; clients may omit it to receive a generated token.

`shuttingDown` answers a request the server could not finish because it is
shutting down (section 5.6). `invalidCursor` asks the client to restart a
history/list read; `payloadNotFound` asks it to obtain a fresh payload
reference; `archiveConflict` reports an existing destination without moving
anything. Clients preserve `error.data` in `AppServerError`, not just its
code and message, so paths and recovery instructions remain actionable.

Both directions carry requests: the server sends `item/toolCall/requestApproval`
and `ui/dialog` as requests and waits for the client's response.

The first client message must be `initialize`:

```ts
interface InitializeParams {
	clientInfo: { name: string; version: string };
	capabilities: {
		localHandles?: boolean;               // true only on the in-process transport
		optOutNotifications?: string[];       // exact notification method names this connection never receives
	};
}
interface InitializeResult {
	serverInfo: { name: "knightcode"; version: string };
	platform: { os: "win32" | "darwin" | "linux"; arch: string; homeDir: string };
}
```

`optOutNotifications` is checked in the fan-out, before a notification is
serialized: the terminal opts out of `thread/tokenUsage/updated` when its
footer reads usage itself, a client that renders no reasoning opts out of
`item/reasoning/delta`. Opting out of a sidebar notification only affects
that connection. Unknown names are ignored, so a client written for a later
protocol does not fail. `platform` lets a client shorten paths under
`homeDir` and label shells without asking the host OS itself.

There is no protocol version, as in Codex's app server: the desktop app
bundles its server, and a client that needs a newer one compares
`serverInfo.version`. The client then sends the `initialized` notification. Any other
method before that answers `notInitialized`.

### 4.2 Data types

```ts
interface Thread {
	id: string;
	cwd: string;                // the worktree path for a worktree thread
	projectCwd: string;         // the project the thread belongs to; equals cwd for a local thread
	name: string;               // session name, or first line of the first message
	status: ThreadStatus;
	archived: boolean;
	createdAt: string;          // ISO 8601, from the session header
	updatedAt: string;          // ISO 8601
	forkedFromId?: string;      // the parent's header id (never parsed from a file name); absent when the parent is gone
	workspace:
		| { mode: "local"; worktree?: string } // worktree: the one a handed-off thread came from (6.1)
		| { mode: "worktree"; path: string; baseRef: string; ownerThreadId: string; // baseRef: a commit SHA (6.1)
		    environment?: string; setupFailed?: boolean; deleted?: boolean };
	approvalMode: ApprovalMode;
	model?: ModelRef;
	thinkingLevel: ThinkingLevel;
	sessionFile?: string;       // the session file on disk; absent until the thread is first saved
}

type ThreadStatus =
	| { type: "notLoaded" }
	| { type: "idle" }
	| { type: "active"; waitingOn: ("approval" | "dialog")[] }
	| { type: "systemError"; message: string };

interface Turn {
	id: string;
	threadId: string;
	status: "inProgress" | "completed" | "interrupted" | "failed";
	error?: TurnError;
	startedAt: number;          // Unix ms: the marker entry's timestamp
	completedAt?: number;       // Unix ms: the end entry's timestamp
	items: Item[];              // filled on thread/read; empty on turn/started
}

interface TurnError {
	message: string;
	kind: "auth" | "rateLimit" | "contextOverflow" | "network" | "provider" | "other";
}

interface ItemTimes { startedAt?: number; completedAt?: number } // Unix ms, section 4.2 "Timestamps"

type Item = ItemTimes & (
	| { type: "userMessage"; id: string; text: string; images: ImageRef[]; clientMessageId?: string }
	| { type: "agentMessage"; id: string; text: string }
	| { type: "reasoning"; id: string; text: string }
	| { type: "toolCall"; id: string; tool: string; input: unknown;
	    status: "pending" | "running" | "completed" | "failed" | "declined";
	    output: ToolOutput[]; parentItemId?: string;
	    fileChanges?: FileChange[]; view?: View }
	| { type: "compaction"; id: string; summary: string }
	| { type: "extensionMessage"; id: string; extension: string; text: string; view?: View });

interface FileChange {
	path: string;
	kind: "add" | "modify" | "delete";
	diff?: string;              // unified diff of this file from the tool's result
}

type ApprovalMode = "ask" | "autoEdit" | "fullAccess";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
interface ModelRef { provider: string; id: string; name: string; contextWindow: number }
type ToolOutput = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string };
interface ImageRef { mimeType: string; data: string } // base64, as the session file stores images
type ImageInput = ImageRef | { path: string };         // a client-side file the server reads (section 4.4)

interface TokenUsage {
	input: number; output: number; cacheRead: number; cacheWrite: number;
	cost: number;               // USD, as the provider usage reports it; 0 when unknown
	contextTokens?: number;     // tokens of the last request's context; absent until the first reply
	contextWindow: number;
}

interface PayloadRef {
	id: string;                 // opaque capability, not a path or a client-selected file name
	byteLength: number;         // UTF-8 JSON bytes
}
interface ItemReference {
	type: "itemReference"; id: string; itemType: Item["type"]; payload: PayloadRef;
}
interface TurnSummary {
	id: string; threadId: string; status: Turn["status"]; error?: TurnError;
	startedAt: number; completedAt?: number;
}
interface TurnReference extends TurnSummary { payload: PayloadRef }
type WireItem = Item | ItemReference;
type WireTurn = Turn | TurnReference;
interface TurnStartResult {
	status: "started" | "handled" | "cancelled";
	threadId: string;            // the effective thread, including a replacement
	requestId: string;           // echoed client token, or a generated token
}
```

`ThinkingLevel` mirrors `@knightcode/agent` by value. A protocol test asserts
the two unions are equal so they cannot drift.

`ThreadStatus` is an object so the sidebar can tell blocked from busy without
subscribing: `waitingOn` lists the kinds of server request currently open on
the thread (an approval, an extension dialog), and every change to it is a
`thread/status/changed`. `systemError` is entered when the server unloads a
thread for a reason the user must see (its lock was lost, section 5.5; a
reload after a crash failed) and is left by the next successful load.

#### Timestamps

Every message in the session file carries `timestamp` (Unix ms), and custom
entries carry the entry's own, so times read back exactly as they streamed:

- A turn starts at its marker's timestamp and completes at its end entry's,
  including a marker the mapper wrote itself when the built-in did not. A
  turn whose end entry could not be written (its lock was lost) completes live
  at the time the run settled, and reads back `interrupted` with no
  `completedAt`: the one case where live and read-back differ, as they already
  do for its status.
- An assistant message's `timestamp` is when its request started and its
  `durationMs` how long the response took (`packages/ai/src/types.ts:589-596`).
  Its `agentMessage` and `reasoning` items start at `timestamp` and complete
  at `timestamp + durationMs` (absent `durationMs`: no `completedAt`).
- `userMessage` items complete at the message's `timestamp`. `compaction`
  items complete at the compaction entry's timestamp, which exists before
  `compaction_end` is emitted. `extensionMessage` items complete at the custom
  message's `timestamp`; its entry is written with that same timestamp
  (`appendCustomMessageEntry` takes it), so read-back agrees. None of the
  three carries `startedAt`.
- A top-level `toolCall` starts when its assistant message completed
  (`timestamp + durationMs`, else `timestamp`) and completes at its tool
  result's `timestamp`, so its duration includes any time spent waiting for
  approval. A nested call's times are live only, as the call is.

#### Client message ids

`clientMessageId` is never inferred from text: hooks transform input, skills
and templates expand it, image processing appends hints, and commands consume
it. It rides on the input that starts a turn (`turn/start`, a queued input):
the thread holds it beside `pendingTurnRequestId`, the mapper takes it at
`agent_start` and puts it on that turn's first `userMessage`. It is never
persisted. An input that a command or hook handles starts no turn and echoes
nothing; a removed queued input takes its id with it. Steers carry none.

#### Turn error kind

An assistant message records `errorMessage` and diagnostics but no HTTP
status, and auto-retry already classifies errors by message pattern
(`isRetryableAssistantError`, `packages/ai/src/utils/retry.ts`). So `kind`
comes from `classifyAssistantError` in the turn-marker built-in
(`packages/cli/src/extensions/turn-marker.ts`), with its own patterns: `isContextOverflow` (`packages/ai/src/utils/overflow.ts:137`) is
`contextOverflow`; the provider-limit and rate patterns are `rateLimit`;
authentication patterns (unauthorized, invalid or missing key, expired
token) are `auth`; connection and stream failures are `network`; any other
error is `provider`. `other` is for a run that failed without an assistant
error (the prompt rejected) and for legacy string errors. One function serves both paths and the
end entry stores the kind with the status. Clients choose an action from it
("Sign in", "Compact and retry", "Retry") and never parse `message`.

A failure thrown by a host hook (an extension's `prepareRequest`) is
classified by its wording like any other. Pi's retry likewise retries one
whose text looks transient; telling the two apart needs provenance on the
message, a harness change that belongs upstream, not in this server.

#### File change diffs

`edit`'s result already carries a unified `patch` (`core/tools/edit.ts:208`);
`fileChanges[].diff` is that patch for the file. A call whose diff makes the
item larger than 64 KiB travels as an `ItemReference` like any other large
item (section 5.9), so no second size rule is needed. `write` produces no patch, so its change carries no `diff`; the
changes pane (section 6.2) is the complete view. Extension tools that report
`fileChanges` in their result details may supply `diff` the same way.

`View` is section 8.2.

#### Ids, and turns read back from the session file

`thread/read` must return the same ids the live notifications carried, or
`thread/fork {atItemId}` and diff comments would point at nothing. Two facts
rule out the obvious choice of entry ids:

- The session file has no turn boundaries. A turn can hold several user
  messages (steers, follow-ups), so "one user message to the next" would
  split a live turn on read-back.
- `agent_start` is not a turn boundary either. One prompt can start the
  agent several times and settle once: an automatic retry
  (`agent-session.ts:3826-3865`), a follow-up, and overflow recovery each
  emit another `agent_start` before the single `agent_settled`
  (`:1112-1122`).
- Subscribers see `message_end` before the session appends the entry
  (`agent-session.ts:1172-1194`: `_emit`, then `appendMessage`), and see
  `agent_start` before any entry of the turn exists. A live item never knows
  its entry id.

So:

- A built-in hidden inline extension, `turn-marker`, appends a custom entry
  `knightcode.turn` at the first `agent_start` of a run, and
  `knightcode.turnEnd` with `{status, error?}` at `agent_settled`. Later
  `agent_start`s of the same run write nothing. Turn id = the marker's entry
  id. Every surface loads the built-ins, so the terminal writes markers too.
  The tree view already hides custom entries.
- `ItemMapper` does not assume the marker is the leaf: another extension's
  `agent_start` handler may append after it. At a run's first `agent_start`
  it walks back from the leaf to the first marker, stopping at any message
  or turn end. If it finds none (the built-in was disabled through settings,
  or failed), it appends the marker itself, and the end entry at
  `agent_settled`, so live and read-back ids still agree.
- The end entry's status uses one function on both paths: an abort wins,
  otherwise the last assistant message decides (`aborted` is `interrupted`,
  `error` is `failed`, anything else `completed`).
- Read-back: on the active branch, each marker starts a turn and its end
  entry gives its status. Entries after the end entry and before the next
  marker (a compaction on an idle thread) stay in that turn. A marked turn
  with no end entry is `inProgress` if the thread is loaded and running it,
  and `interrupted` otherwise: the process died mid-turn. In a session
  written before markers existed, each user message starts a turn and the
  last assistant message's stop reason gives its status; a user message
  never splits a marked turn. Entries before the first turn belong to none,
  and a turn with no items (a fork cut right after a marker) is dropped.
- Item ids are ordinals within the turn, counted in entry order, which is
  the order the live events arrive in: `<turnId>:user:<k>` for the k-th user
  message, `<turnId>:custom:<k>` for custom messages,
  `<turnId>:compaction:<k>`, and `<turnId>:<n>:<blockIndex>` for text and
  thinking blocks of the n-th assistant message. An assistant message is
  counted at its `message_end`, as its entry is written then; a failed
  attempt that a retry replaces is still an entry, so it counts. A tool call
  item's id is the tool call id.
- Tool calls have one creation rule on both paths. A call is an item from
  its assistant message's `message_end`, at its block's position, with status
  `pending`, whether or not it ever runs; execution only changes its status.
  Results never add or move items: the files an `edit` or `write` changed are
  the call's `fileChanges`, not an item of their own. So an aborted reply's
  unexecuted call exists live and on read-back. A call still unfinished when
  its turn ends completes as `failed`, which is also how a call without a
  result reads back. Only calls in the mapper's actual active turn may be
  `pending` or `running` on a live read; a new run never revives an unfinished
  call in an earlier interrupted turn. Nested calls are the exception: they have no block,
  start at execution, and are live only.
- Item order is explicit, not arrival order. Text and thinking items start
  while their message streams; tool call items start at `message_end`. For
  assistant content `[toolCall, text]` the text item would arrive first, but
  the file holds the call first. So every `item/started` and
  `item/completed` carries `index`, the item's position among its turn's
  top-level items, which is its position in `thread/read`'s `items`. An item
  that streams gets a provisional index; at its message's `message_end` the
  mapper completes every item of that message with its final index, in
  block order. Clients order a turn's items by `index` and move an item when
  its `item/completed` index differs. Indexes of earlier messages never
  change. Nested calls carry no index; they render under `parentItemId`.
  Streaming `item/started` may carry provisional `startedAt: Date.now()`;
  `item/completed` replaces the placeholder's times, text, fileChanges and
  index with the finalized values.
- The finalized message decides, not the stream. `message_end` handlers may
  replace a message (`emitMessageEnd`), and the session saves the
  replacement. So `item/completed` takes an assistant message's text and
  blocks from its `message_end`, and a call's status, output and
  `fileChanges` from its tool result's `message_end`, never from
  `tool_execution_end`. An item that streamed but whose block the finalized
  message no longer has is withdrawn with `item/removed`. The mapper first
  removes every obsolete streamed item, including blocks whose kind changed,
  then starts/completes the finalized blocks. Text replaced by thinking at
  the same block index reuses its durable ordinal id: the removal must come
  before the replacement's start, never after it.
- Between runs, an idle compaction or extension message belongs to the last
  turn and continues its ordinals. After a load the mapper has seen no turn,
  so it seeds those ordinals from the turns read back from the file.
- Live, a compaction outside a turn (`thread/compact` on an idle thread)
  belongs to the thread's last turn, as it does on read-back.

What is durable and what is not:

| Data | Durable | Read back by `thread/read` |
| --- | --- | --- |
| Turn boundaries and outcome | marker and end entries | yes |
| User, assistant, custom messages, compactions | session entries | yes |
| Top-level tool calls and results | session entries | yes |
| Nested tool calls (code mode) | no: the parent's result records a bounded summary without outputs | no; live only, as items with `parentItemId` |
| Partial text of a running assistant message | no | from the live mapper only (section 4.5) |

The server maps an item id back to its entry (`thread/fork`, diff comments)
by walking that turn. `thread/read` returns the active branch only; the rest
of the tree is Phase D's `thread/tree/read`.

### 4.3 Event mapping

`ItemMapper` subscribes to one session and emits notifications:

| Session event | Notification |
| --- | --- |
| `agent_start`, first of a run | `turn/started`, id from the run's marker (section 4.2); `thread/status/changed` `active` |
| `agent_start`, later in the same run | nothing |
| `message_end` (user) | `item/started` + `item/completed` `userMessage` |
| `message_end` (custom, from `sendMessage`) | `item/started` + `item/completed` `extensionMessage`; `extension` is the message's `customType`; between runs it joins the last turn |
| `message_update` `text_delta` | `item/agentMessage/delta` (an `agentMessage` item starts, with a provisional `index`, on its block's first delta) |
| `message_update` `thinking_delta` | `item/reasoning/delta` (a `reasoning` item starts on its block's first delta) |
| `message_end` (assistant) | first `item/removed` for every obsolete streamed block (gone or changed kind); then, in block order, `item/started` `toolCall` `pending` for each call, `item/started` for a new text/thinking block, and `item/completed` for every text/thinking item with finalized text and `index`; the assistant counter advances; then `thread/tokenUsage/updated` with the thread's accumulated usage and this request's context size |
| `message_end` (tool result) | `item/completed` `toolCall` with status, output, and `fileChanges` for `edit` and `write`, from the saved result |
| `tool_execution_start` | nothing for a top-level call (the snapshot shows it running); `item/started` `toolCall` `running` with `parentItemId` for a nested call |
| `tool_execution_update` | `item/toolCall/outputDelta` |
| `tool_execution_end` | `item/completed` for a nested call only; a top-level call completes at its result's `message_end` |
| `compaction_start` / `compaction_end` | `thread/status/changed` `active` / `item/started` + `item/completed` `compaction` (the summary exists only at the end) |
| `auto_retry_start` / `auto_retry_end` | `turn/retry` with attempt and delay |
| `queue_update` | `turn/queue/updated` (steer and follow-up queues) |
| `session_info_changed` | `thread/name/updated` |
| `thinking_level_changed` | `thread/settings/updated` |
| extension event `model_select` | `thread/settings/updated`. There is no session event for a model change, and `appendModelChange` emits no `entry_appended`; the thread's hidden inline extension (section 5.4) listens for `model_select`, which also covers an extension's `setModel` |
| `agent_settled` | `item/completed` `failed` for calls that never finished; `turn/completed` to subscribers and `thread/turn/completed` to every initialized connection with one bounded outcome summary from the turn's end entry, then `thread/status/changed` `idle`, then `turn/diff/updated` when files changed while it ran (section 6.2) |

Outside the session's events, the thread itself emits
`thread/status/changed` whenever its open server requests change kind (the
first approval or dialog opens, the last one resolves), so `waitingOn` is
current in every sidebar.

`agent_end` is not mapped: a turn ends when the session settles, after queued
follow-ups. The engine's `forward()` (`sessions.ts:250-312`) is the starting
point; the status comes from the end entry (section 4.2), so a live
`turn/completed` and a later `thread/read` agree except when a lost lock
prevents writing the end entry (section 4.2).

The mapper keeps the running turn's items, including the text streamed so
far, so `thread/resume` and `thread/read` can return a running turn as it
stands (section 4.5). Every item a notification carries is a copy: the
in-process transport passes objects, and the mapper keeps mutating its own.

### 4.4 Methods

Client to server. Grouped by phase (section 10); every method listed is in
scope for this specification.

Phase A:

| Method | Params → result |
| --- | --- |
| `thread/start` | `{cwd, workspace?, approvalMode?, model?, thinkingLevel?}` → `{thread, warnings}`; `thread.model` is absent when no model is available yet (section 5.2); `warnings` are the thread's load diagnostics (section 4.5) |
| `thread/resume` | `{threadId, cursor?}` → `{thread, turns, runningTurn?, nextCursor?, queue, usage, warnings}`; `warnings` are the thread's load diagnostics, returned on every resume so each window that opens the thread sees them; `usage` is the thread's `TokenUsage` as the terminal footer computes it (`AgentSession.getSessionStats()`: every entry, compacted history included, so it matches what was billed; context from `getContextUsage()`); subscribes the connection; historical `turns` are paged independently of the complete current `runningTurn` snapshot (section 4.5) |
| `thread/fork` | `{threadId, atItemId?}` → `{thread, warnings}` |
| `thread/list` | `{cwd?, cursor?, archived?}` → `{threads, nextCursor?}`; each a `ThreadSummary` (`Thread` without workspace, approval mode, model and thinking level). Names and first messages come from the per-directory `.thread-index.json` cache (section 5.10): a cold list scans each transcript once, a warm list reads none. Continuations page a cached, immutable summary snapshot. With an explicit shared session directory, `cwd` filters by each header |
| `thread/read` | `{threadId, cursor?}` → `{thread, turns, runningTurn?, nextCursor?}`; does not load, subscribe, lock or write the session file. `thread` is a `Thread` when the thread is loaded and a `ThreadSummary` when it is not: workspace, approval mode, model and thinking level live in session state that only a load restores |
| `thread/unsubscribe` | `{threadId}` → `{status: "unsubscribed" \| "notSubscribed"}` |
| `thread/archive` / `thread/unarchive` | `{threadId}` → `{}` |
| `thread/delete` | `{threadId}` → `{}`; refuses before disturbing anything: an unarchived thread answers `threadNotArchived`, and a busy one `turnInProgress`, checked synchronously in the same step that enters the closing transition (section 5.6), so no turn can start between the check and the fence. Inside the transition it checks the file and busy again before disturbing anything, and a refusal there puts the thread back, still loaded and subscribed. Only then does it unload the thread, take the file's lock exclusively without reading or repairing the transcript, verify the header id, unlink, and broadcast `thread/deleted`. Another process's lock answers `threadLockedElsewhere`; an unlink failure keeps the file and answers `internal`. Clients confirm with the user first: it cannot be undone |
| `thread/name/set` | `{threadId, name}` → `{}` |
| `thread/settings/update` | `{threadId, model?, thinkingLevel?, approvalMode?}` → `{thread}`; also during a turn, applying from the next model request, as the terminal's `/model` does |
| `thread/compact` | `{threadId, instructions?}` → `{}` |
| `turn/start` | `{threadId, text, images?: ImageInput[], requestId?, clientMessageId?}` → `TurnStartResult`; `started` means preflight accepted a run, `handled` means a command/input hook handled it without a run, and `cancelled` means the signal stopped it. The result names the effective thread and correlation token. `turn/started {turn, requestId?}` carries the same token for request-launched runs; its durable turn id still comes from the marker at `agent_start`, and it may precede the response. Only `started` requires a later completion. A busy turn/compaction or conflicting preflight answers `turnInProgress`. Images given by path (`ImageInput`) are read before the start is admitted, so a bad path answers `invalidParams` and starts nothing; a `turn/interrupt` sent during that read (at most 20 MiB per image) finds no start to cancel |
| `turn/steer` | `{threadId, expectedTurnId, text, images?}` → `{}`; hands the input to the running turn through the agent's own steering, where it cannot be taken back. `invalidParams` when no turn runs (use `turn/start`), `turnMismatch` when the running turn is not `expectedTurnId`. Images given by path are read before the input is admitted (as for `turn/start`) |
| `turn/queue/add` | `{threadId, text, images?, clientMessageId?}` → `{queueId}`; the server holds the input and starts it as its own turn once the thread is idle, oldest first (at once on an idle thread). A queued input that fails to start is dropped with an `error` notification. `turn/interrupt` drops the queue |
| `turn/queue/remove` | `{threadId, queueId}` → `{removed: boolean}`; removes a queued input that has not started. `removed: true` means it never starts; false means unknown, already started, or already removed. The queue lives in the server, so removal never races the agent loop. Editing a queued input is remove then re-add |
| `turn/interrupt` | `{threadId, turnId?}` → `{}`; with `turnId`, `turnMismatch` when another turn runs, so a late click cannot stop the next turn |
| `payload/read` | `{id, offset, maxBytes?}` → `{data, nextOffset?, eof}`; `data` is base64 for a bounded byte chunk of referenced UTF-8 JSON (section 5.9) |
| `model/list` | `{}` → `{models, default}`; each model carries `thinkingLevels: ThinkingLevel[]`, the levels it accepts (`["off"]` for a model without reasoning), so a picker offers only those |
| `command/list` | `{threadId}` or `{cwd}` → `{commands}` (extension commands, prompt templates, skills, as `commandsOf` builds them). With `cwd` the server lists what a new thread in that project would offer, from an unbound in-memory session |
| `config/read` | `{cwd?}` → `{settings, origins, versions, errors}`; settings, origins and each version come from one read of each file as it is now (never from state loaded earlier), so a version always matches the settings returned. `origins` maps each set dotted key to `"global"` or `"project"` (absent: default); `versions` is `{global, project?}`, a content hash of each file; `errors` are settings files that failed to parse, as `Warning`s with path and, when the runtime reports it, line and column |
| `config/write` | `{scope: "global" \| "project", cwd?, key, value, expectedVersion?}` → `{version}`; `key` is a dotted path, `value` `null` deletes it. A stale `expectedVersion` answers `configConflict` and writes nothing. The compare and the write happen under the settings file's lock, also when the file does not exist yet, on a write queue shared by every settings manager in the process for that file (so a write queued earlier by a thread's manager lands first), and the call answers only once the server's settings reflect the file. Global writes go through the server's own settings manager. The file keeps its other keys |
| `project/trust/read` | `{cwd}` → `{trusted: boolean \| null, needsTrust: boolean}`; `null` when the user has not decided |
| `project/trust/set` | `{cwd, trusted}` → `{}`; records the decision in `ProjectTrustStore`, as the terminal's prompt does (`main.ts:854-891`); loaded threads in that project see it on their next load |
| `file/search` | `{cwd, query, limit?, searchId?}` → `{files: {path, score, indices}[], truncated}`; fuzzy match over the files the `find` tool lists for `cwd` (gitignore respected), at most `limit` (default 50). A newer request with the same `searchId` makes the older one answer at once with no files, even while the listing is still running, and a listing nobody waits for any more is stopped. At most 2 listings run at once; listings are cached per cwd for 10 s, at most 8 cwds, and read at most 32 MiB of output. `truncated` is true when the 32 MiB output cap or 200,000-path cap was reached (cached) or `fd` failed after printing some files (served, not cached); `fd` failing with no output answers `internal` with its error output, never cached. The listing process is killed after 15 s and on shutdown; `fd` missing answers `toolMissing` |
| `mcp/app/readResource` | `{threadId, server, uri}` → `{contents, _meta?}`; an MCP App reads its own server's resource (desktop-shell.md section 12), through the thread's MCP extension over the session's event bus. A result over 4 MiB serialized answers `invalidParams`; a server not connected, `mcpUnavailable` |
| `mcp/app/callTool` | `{threadId, server, name, arguments?, confirmed?}` → `{content, structuredContent?, isError?, _meta?}`; only a tool of the app's own server whose `_meta.ui.visibility` includes `"app"` and that the configuration does not hide. Outside `fullAccess` a tool not annotated `readOnlyHint` answers `approvalRequired` until `confirmed`. Arguments to 1 MiB, results to 4 MiB, serialized; it does not wait for a running turn. The tool call item's `mcpApp {server, resourceUri, result?, resultOmitted?}` is what the client draws |
| `file/read` | `{threadId, path, maxBytes?}` → `{path, size, binary, tooLarge, text?}`; the desktop's read-only file tab (v1-completion-plan.md, S2b). `path` resolves against the thread's cwd as a tool's does; text only when the file has no NUL in its first 8 KiB and fits `maxBytes` (1 byte to 8 MiB, default 2 MiB) |
| `server/diagnostics` | `{}` → `{rssBytes, heapBytes, loadedThreads, loadingThreads, payloadFiles, payloadBytes, inactiveFactories, uptimeMs, listingFilesOpened, listingBytesScanned}`; the figures section 13 measures, observable in a shipped app. The two listing counters are running totals of the transcripts and parent headers the listing opened and the transcript bytes it scanned (section 5.10) |
| `account/list` | `{}` → `{accounts}` |
| `account/login/start` | `{provider, type: "oauth" \| "api_key"}` → `{loginId}`; progress as `account/login/updated` (a provider can offer both) |
| `account/login/answer` | `{loginId, value}` → `{}` |
| `account/login/cancel` | `{loginId}` → `{}`; aborts the flow, which closes an OAuth loopback listener |
| `account/logout` | `{provider}` → `{}` |

Phase B: section 6. Phase C: section 8. Phase D adds the terminal's remaining
needs (section 7.2).

Server to client notifications: `thread/started`, `thread/replaced`,
`thread/status/changed`, `thread/deleted`, `thread/tokenUsage/updated`
(`{threadId, turnId, usage: TokenUsage}`), `warning` (`{message, threadId?,
source: "settings" | "extension" | "trust" | "server", path?, line?,
column?}`: something the user should fix that did not fail a request, such as
an extension that failed at runtime; routed as section 4.5 says),
`thread/name/updated`, `thread/settings/updated`, `thread/archived`,
`thread/turn/completed` (`{turn: TurnSummary}`, without items or payload),
`turn/started`, `turn/completed`, `turn/retry`, `turn/queue/updated`,
`turn/diff/updated` (Phase B; not in the Phase A schema), `item/started`,
`item/completed` (both with the item's
`index`, section 4.2), `item/removed`, `item/agentMessage/delta`,
`item/reasoning/delta`, `item/toolCall/outputDelta`, `serverRequest/cancelled`
(a server request the client has not answered was withdrawn: the turn was
interrupted, the thread unloaded, or the client unsubscribed, so the client
closes its dialog), `account/login/updated`,
`account/updated`, `error`.

Server to client requests: `item/toolCall/requestApproval` (section 5.4),
`ui/dialog` (section 8.1).

### 4.5 Subscriptions

A connection is subscribed to a thread after `thread/start`, `thread/resume`,
`thread/fork` or `turn/start` on it, and stops after `thread/unsubscribe` or
disconnect. `thread/list` and `thread/read` never subscribe.

Two kinds of notification:

- Sidebar notifications go to every initialized connection, so a thread
  list stays current without subscribing to every thread: `thread/started`,
  `thread/status/changed`, `thread/name/updated`, `thread/archived`,
  `thread/deleted`, `thread/turn/completed`, `warning` without a `threadId`,
  `account/login/updated`, `account/updated`.
- Every other thread-scoped notification goes only to subscribers:
  `thread/replaced`, `thread/settings/updated`, `turn/*`, `item/*`, and
  `warning` with a `threadId`.
  `serverRequest/cancelled` goes to the connection the request went to.

`thread/turn/completed` carries the same times, status and bounded typed
error as `turn/completed`. Sidebar initialization reads the newest
`thread/read` page for visible rows only, without loading or subscribing;
`TurnReference` exposes the same summary without fetching its payload. No
persisted outcome index or server-side unread state is needed.

Warnings that arise while a thread loads (its project settings fail to
parse, an extension fails to import or reports a warning, the project's own
resources were skipped because it is not trusted yet) exist before any
connection is subscribed, so a notification would reach no one. They are kept
on the loaded thread as its load warnings and returned in the response of
`thread/start`, `thread/resume` and `thread/fork`. Warnings after load go to
the thread's subscribers. `config/read` returns settings parse errors in its
own result, so the settings screen shows them without a thread.

History cursors are opaque, versioned anchors, not offsets from a moving
end. Each binds the thread id, branch-tip entry id at the initial read, last
returned turn id, and the active turn excluded from that historical view.
Later appends do not shift it. A continuation reads only that anchored branch
prefix. Reject malformed, cross-thread or no-longer-active-branch anchors
with `invalidCursor`; do not silently read a different branch. Return turns
in chronological order within each page, newest page first, at most 50 turns
and 1 MiB of serialized response bytes. A single oversized turn is returned
by `TurnReference`, not dropped or sent as an oversized line (section 5.9).

`thread/resume` returns the requested historical page and, separately,
`runningTurn`: the mapper's complete current snapshot, including partial text
and nested calls, represented inline or by an immutable `TurnReference`.
Historical pages exclude that turn, so it appears once. Even a resume with
an old cursor supplies the current running snapshot. The server freezes the
snapshot, validates the cursor, and subscribes in the synchronous commit
that writes the response. That commit also computes required `queue: TurnQueue`
(`steering` texts and `followUp` `{id, text}` entries) from live state, never
from history or handler-entry state. An empty snapshot clears stale client
queue entries; invalid cursors establish no subscription or queue snapshot. The
first subsequent notification is the next change. When a snapshot is a
reference, the client buffers subsequent notifications while fetching its
chunks, installs it, then replays those notifications in order. Payload
chunk responses are processed independently so this buffering cannot block
the requests needed to fetch the snapshot. Nothing falls between or is
applied twice. `thread/read` provides the same separate snapshot for loaded
threads but never establishes a subscription.

Listing cursors refer to a 5-minute immutable summary snapshot and its next
index, bound to the `cwd`/`archived` filters. A new initial list refreshes it;
sidebar notifications update current state independently. Expiry or changed
filters answers `invalidCursor`. Keep at most 32 such snapshots, evicting the
least recently used; eviction also makes their cursors invalid. A cold
initial listing scans each transcript once; a warm one reads zero transcript
bytes through `.thread-index.json` (section 5.10; section 13 measures both).

A server request goes to one subscriber: the one that most recently started a
turn on that thread. The thread records which subscriber each open request
went to. If that subscriber disconnects or sends `thread/unsubscribe`, the
request is withdrawn from it (`serverRequest/cancelled` to that connection,
when it is still open) and moves to the next subscriber; with none left it
resolves as cancelled, and the tool call is blocked with "Tool call
cancelled", as `permissions.ts` did. Without the unsubscribe case, a desktop
window that hides a thread and its dialog would leave the tool waiting with
nobody able to answer.

An extension command that replaces the session (`ctx.newSession`, `ctx.fork`,
`ctx.switchSession`; plan mode's "Implement in a fresh session" is one) does
what `AgentSessionRuntime` does in the terminal, in the same order:

1. Emit the cancellable `session_before_switch` (new, resume) or
   `session_before_fork` on the old session. A cancel returns
   `{cancelled: true}` to the command and changes nothing.
2. Get the target through the thread manager's one load path
   (section 5.6). A target already loaded in this process is reused, not
   loaded twice; a target another process holds fails with
   `threadLockedElsewhere`.
3. Transfer the initiating start's cancellation ownership and request token
   to the target before disposing the old thread. Keep the same controller
   and signal: an interrupt during target loading remains cancelled. A
   forwarded `withSession` dispatch reserves the idle target through its
   preflight, so a competing target start cannot overtake it; an already busy
   target fails before subscriptions move. Transfer no unrelated starts.
4. Move every subscription from the old thread to the target, and send
   `thread/replaced {oldThreadId, thread}`.
5. Unload the old thread now, as `teardownCurrent` does: abort,
   `session_shutdown` with the replacement's reason and target file, dispose.
   Its extension contexts go stale at once instead of at the idle timeout.
   This step does not wait in the old thread's queue: the caller is the
   command running on it. Disposal aborts the old thread's remaining starts,
   not the transferred start. Setup and `withSession` still use that start's
   signal, and the final request disposition names the replacement thread.
   Target interrupt/unload and process shutdown cancel it there; completion
   removes it from its current owner's set, not its original owner's set.

### 4.6 What the Codex study added

Nothing has shipped against the protocol, so these changes were made in place
and the sections above already describe them; there is no version number to
bump (4.1). This section is the list of what the Codex study added after
Phase A, for the implementer of Phase A2 (section 10).

Each change exists because a shipped multi-thread desktop client needed it.
The Codex desktop app's bundled server was the reference: where it has the
same capability, its shape was weighed; where KnightCode's design is already
stronger, it was left alone (end of this section).

| Change | Why |
| --- | --- |
| `ThreadStatus` becomes an object with `active.waitingOn` and `systemError` (4.2) | With twenty threads, the sidebar must show which are blocked on the user without subscribing to them. Codex: `activeFlags` `waitingOnApproval`, `waitingOnUserInput` |
| `Thread.createdAt`, `forkedFromId` (4.2) | Sort by creation; show "Forked from" |
| `Turn.startedAt`, `completedAt`; item `startedAt`, `completedAt` (4.2) | "Worked for 2m", "Ran in 4.2s"; read back from message timestamps, so live and read-back agree |
| `Turn.error` becomes `TurnError {message, kind}` (4.2) | A client picks "Sign in" or "Compact and retry" from `kind` instead of matching text. Codex's desktop matches error text to detect a missing capability, which is the failure this prevents |
| `thread/turn/completed` sidebar summary, initialized by newest-page `thread/read` (4.3–4.5) | Every window sees failed and unread outcomes without subscribing to every thread |
| `FileChange.diff` (4.2) | Inline per-file diffs in the transcript without a git call per tool row |
| `ImageInput` adds `{path}` (4.2, 4.4) | A 4K screenshot is about 8 MiB as base64 inside one `turn/start` line; the server and client share a disk, so the client sends the path. Codex: `localImage {path}` |
| `clientMessageId` on `turn/start` and `turn/queue/add`, echoed on the turn's first `userMessage` (live only), never matched by text (4.2) | Optimistic rendering of a sent message, reconciled when the item arrives |
| `expectedTurnId` on steer, `turnId` on interrupt, `turnMismatch` (4.1, 4.4) | A steer typed while turn 1 ends must not land in turn 2; an interrupt clicked late must not stop the next turn. Codex: `expectedTurnId` is required on steer |
| Required live `queue: TurnQueue` on resume at the synchronous send commit; a server-side queue: `turn/queue/add` returns `queueId`, each input starts its own turn when the thread is idle, `turn/queue/remove`; `turn/queue/updated` carries undelivered steers as text and queued inputs as `{id, text}` (4.4) | The composer edits and deletes queued messages. Codex keeps its queue above its core (`codex-rs/ext/queue`, `thread_queue_processor.rs`; the core only offers "start if idle"), and so does this server: no agent-loop change, nothing to withdraw from a loop that already drained it |
| `thread/tokenUsage/updated`, `TokenUsage` (4.3, 4.4) | A context ring and cost per thread, pushed after each reply. Replaces Phase D's `thread/contextUsage/read` and `thread/stats/read` pulls (section 7.2) |
| `model/list` `thinkingLevels` per model (4.4) | The picker offers only levels the model accepts |
| Approval `decisions`, `reason`, command `prefix`, decline `message`, `acceptPrefixForSession` (5.4) | `acceptForSession` on `bash` approves every shell command, which makes `ask` meaningless after one click. Codex: "Allow commands that start with …" |
| `config/read` origins, versions and parse errors from one read, `config/write`, `configConflict`, load warnings in `thread/start`/`resume`/`fork` results, `warning` (4.4, 4.5) | The settings UI edits settings through the server that owns them, without clobbering a concurrent edit, and shows where a value comes from |
| `project/trust/read`, `project/trust/set` (4.4) | The desktop's trust prompt (desktop-shell.md section 9.12) without a desktop-side trust store |
| `file/search` (4.4) | `@` file mentions in the composer. Codex: `fuzzyFileSearch` |
| `thread/delete`, `thread/deleted`, `threadNotArchived` (4.1, 4.4) | Users remove threads for good; restricting it to archived threads makes deletion a two-step act |
| `thread/unsubscribe` result status (4.4) | The desktop's main process counts holders (desktop-shell.md section 4.3) and needs to know whether it was subscribed |
| `initialize` `optOutNotifications`, result `platform` (4.1) | Clients skip traffic they never render; paths and shell labels need the host's OS and home directory |
| `server/diagnostics` (4.4) | Section 13's memory figures, observable in a shipped app |
| Listing index (5.10) | Section 13 measured a 31.6 s initial `thread/list` at 10,000 sessions on Windows |
| Worktree `carryLocalChanges`, `.worktreeinclude`, environments with setup and cleanup scripts (6.1) | A new worktree that lacks the user's uncommitted work or `.env` is unusable for the task; most projects need an install step |

Considered and left out, with the reason:

- Sandbox and permission profiles, network rules, an AI reviewer of approvals:
  no OS sandbox in v1 (section 12). The classifier gate's decisions surface as
  `reason` on approvals instead.
- Server-side daemon, WebSocket and Unix socket listeners, remote control,
  remote environments, `fs/*` and `process/*` methods: the server and its
  clients share a machine in v1. When a shared daemon arrives, a stdio-to-socket
  proxy subcommand is the cheapest client path.
- Destructive `thread/revert`: the session tree already keeps every branch;
  `thread/fork {atItemId}` and Phase D's tree navigation cover it.
- Projects, sidebar sections and thread attachments on the server: sidebar
  organisation is desktop state (desktop-shell.md section 7.3).
- Typed tool items (command, file change, MCP call, web search): a generic
  `toolCall` plus `view` keeps extension tools first-class. The desktop
  renders built-in tools by name.
- Separate reasoning summary and raw channels, message phases, plan items,
  goals, memories, realtime voice, plugin marketplaces, scheduled runs.
- Per-turn sticky overrides on `turn/start`: `thread/settings/update` is the
  one way to change settings.
- Numeric error codes: the string codes with `data` are more useful.
- Typed `mention` and `skill` inputs: an `@` mention is text the composer
  inserts (`file/search` finds the path), and a skill is invoked by its
  slash command, which `turn/start` already expands.
- A persistent "Always allow" approval across threads and restarts: approvals
  last for the thread's load (5.4); a lasting allow list is a settings
  change the user makes deliberately, not one click on a request.
- A separate thinking duration ("Thought for 12s"): reasoning items carry
  their assistant message's times, which include the reply after the
  thinking, so the desktop labels the row "Thought" and the turn carries
  "Worked for".

Where KnightCode's protocol was already the stronger design, kept as is: item
`index` and `item/removed`, byte limits and payload references, branch-anchored
history cursors with a frozen running-turn snapshot, start dispositions and
`thread/replaced`, the ownership-token lock, single-recipient approvals,
SHA-pinned worktrees and handoff safety, declarative extension views.

---

### 4.7 The harness boundary

The harness (`packages/agent`, `packages/ai`, and `AgentSession`,
`SessionManager` and `SettingsManager` in `packages/cli/src/core`) comes from
pi and is resynced from it regularly, so every edit there is a merge conflict
on every resync. The server is built on the harness's public API and the
extension API, as Codex's `codex-rs/app-server` is built on `codex-core`.

What multi-thread hosting genuinely needed went into the harness in Phase A:
the session-file lock (section 5.3) and a per-session extension runtime over
the shared model runtime. Everything else lives in
`packages/cli/src/app-server/`:

| Feature | Where |
| --- | --- |
| Queued input, removable until it starts | `LoadedThread.queued`, drained by `ThreadManager` (Codex: `ext/queue`) |
| Steering | the session's own `steer()` |
| Turn error kinds | `classifyAssistantError` in the turn-marker built-in |
| Settings reads and compare-and-swap writes | `config.ts` over `FileSettingsStorage` and `SettingsManager.fromStorage` |
| Optimistic message ids | `LoadedThread.pendingClientMessageId`, taken by the mapper at `agent_start` |
| Extension message times | the mapper reads the saved entry one microtask after `message_end` |

A new feature that seems to need a harness change first states why the
server cannot do it. A genuine harness bug (for example, a host-hook failure
retried as a network error) is fixed upstream in pi and arrives by resync.

**Cancellation lives in the server (Phase A3, done 2026-10-15).** Phase A had
threaded an `AbortSignal` through `AgentSession.prompt()` preflight, model and
thinking changes, extension commands, auto-compaction, `ExtensionRunner.emit*`
and `ModelRuntime.prepareRequest`. A3 reverted all of it. Upstream now treats a
session as busy from the start of a run's preflight, and `abort()` then stops
the run at `agent_start`. The server builds on that:

- `LoadedThread.dispatching` names the start whose `prompt()` is running.
  Session-replacing commands read its signal, so a cancelled replacement backs
  out without the harness carrying the signal.
- A hidden `app-server-start-guard` extension, loaded last, answers `input` with
  `handled` once that start was interrupted. A start interrupted during input
  hooks or a command therefore launches nothing, and `turn/start` answers
  `cancelled` at once while the hooks finish in the background, still holding
  the thread's queue.
- A start interrupted during the run's own preflight (compaction,
  `before_agent_start`) returns `started`, and its turn completes `interrupted`
  without a model request.
- `turn/interrupt` never waits for hooks; unload and EOF answer pending starts at
  once.

What it gave up: hooks already dispatched run to completion. Phase A's
concurrency fixes in `agent-session.ts` (overlapping-prompt guard, `isSettling`
admission, `raceAbort` listener cleanup, compaction-abort results) stay, to be
offered to pi upstream.

## 5. Server internals

### 5.1 Layout

`packages/cli/src/app-server/`:

| File | Owns |
| --- | --- |
| `server.ts` | `AppServer`: one per connection. Handshake, dispatch, outgoing request table, notification fan-out. Transport-agnostic |
| `client.ts`, `errors.ts` | `AppServerClient` (tests now, the terminal in Phase D); `AppServerError`, `SubscriberGone` |
| `transport.ts` | `Transport` interface: `send(message)`, `onMessage`, `onClose`, `close("drain" \| "abort")` |
| `stdio.ts` | ndjson over stdin and stdout with the limits of section 5.9; stderr for logs |
| `in-process.ts` | paired bounded queues; `createInProcessClient()` |
| `context.ts` | `AppServerContext`: the shared `ModelRuntime`, credentials, global settings, connections, `broadcast` |
| `threads.ts` | `ThreadManager`: loaded, loading and closing threads, the one load path, unload, subscribers, idle timer, shutdown. Moved and generalised from `engine/sessions.ts` |
| `loaded-thread.ts` | `LoadedThread`: one session, its mapper, its approval state, its lifecycle state and operation queue |
| `session-files.ts` | session directories, the archive directory, finding a file by the id in its header |
| `transcript.ts` | turns and items read back from session entries (section 4.2) |
| `history-pages.ts` | anchored history cursors and byte-aware pages (section 4.5) |
| `listing-pages.ts` | bounded immutable listing snapshots, retaining Phase A's scan cost |
| `payloads.ts` | immutable JSON payload references and bounded byte reads (section 5.9) |
| `start-request.ts` | cancellation owner, correlation token and first disposition of a start |
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
one `ModelRuntime`, one `AuthStorage`, global `SettingsManager`, the set of
connections.

Per thread: `SettingsManager` for its cwd, `ResourceLoader`, `AgentSession`.
These cannot be shared between threads of one project: `createAgentSession`
binds the resource loader's extension runtime to one session.

Sharing the whole `ModelRuntime` is not enough on its own. Extension
factories run once per thread, but their registrations land in the shared
runtime, and a virtual model's router is bound to the registering session:

```ts
// loader.ts:508-511
route: (request) => model.route(request as ModelRouteRequest<TState>, runtime.createContext()),
```

`ModelRuntime.registerVirtualModel` (`model-runtime.ts:941-960`) replaces an
existing registration with the same provider and id. Thread A loads an
extension with a virtual model, thread B loads the same extension, and from
then on A's turns route through a router that reads B's session. When B
unloads, A's router points at a disposed session.

So routes are owned:

- `ModelRuntime` keeps one route per owner for each virtual model. The owner
  is the registering session's extension runtime (`ExtensionRuntime`, one per
  resource loader). The model stays in the catalog while any owner holds a
  route.
- Routes are registered before a session exists: `createAgentSessionServices`
  flushes them while it builds the services. So every failure path after
  that flush releases them, because no session will: the services builder
  if its own later steps throw, and the thread manager if session
  construction fails before an `AgentSession` exists. Once a session exists,
  its `dispose()` releases them.
- `resolveModel` takes the calling session's owner and uses that owner's
  route, falling back to an unowned route (one an SDK caller registered on
  the runtime directly). A session with neither gets "not registered in this
  session".
- Both routing paths carry the owner: the agent loop's, and direct requests
  outside it. An extension calling `ctx.modelRegistry.streamSimple()` reaches
  `ModelRuntime.streamSimple`, which routes a virtual model through
  `resolveModel` (`model-runtime.ts:705-720`); the session's registry facade
  (created per session at `agent-session.ts:3713`) is bound to its owner and
  passes it on.
- `AgentSession.dispose()` releases every route its owner holds.

Providers (`registerProvider`, `registerNativeProvider`) stay process-wide:
their configs are not bound to a session. One thread's extension calling
`unregisterProvider` removes the provider for every thread; `docs/extensions.md`
says so beside the module-state paragraph (section 5.3).

Discovery: an extension registers its providers when a thread loads it. There
is no separate catalog load at startup (it would run every global extension
once more, with its side effects, outside any thread). So `thread/start`
succeeds without a model; `thread.model` is then absent and `turn/start`
answers `authRequired` until `thread/settings/update` picks one. A client
re-reads `model/list` after `thread/started`, which is when extension
providers can first appear.

Each thread loads `builtInExtensions` (`extensions/index.ts`), as the terminal
does; the engine loaded only plan mode and `ask_user`, so its threads lacked
MCP, code mode, the classifier gate and `/undo`.

Project trust: the terminal asks before loading a project's extensions
(`main.ts:854-891`). The app server never prompts in Phase A. A thread's
`SettingsManager` gets `projectTrusted` from `ProjectTrustStore` (or `true`
when the project has no trust-requiring resources), so an untrusted project
loads without its project-local extensions and settings. How the desktop app
asks the user and records trust belongs to the desktop specification.

The engine's client-backed file tools (`createClientFileTools`) are not restored.
The app server's tools write to disk, as the CLI's do.

### 5.3 Extension isolation

`loader.ts:127-140` clears the whole extension cache whenever a load names a
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
meaning (clear all) for `/reload`. Bound retained factories with a
256-entry least-recently-used cache of inactive entries. Loaded resource
loaders and loads in progress hold leases on their `(cwd, path)` keys;
release leases on disposal and on a failed load. Active keys are pinned;
after the last lease ends, at most 256 inactive keys remain. `/reload`
invalidates the generation for new loads without invalidating factories a
live session is already using. Eviction can re-evaluate an inactive module
on its next load; it never tears down a live extension. Node/Bun/Jiti module
retention is a separate measured cost, not a promise that cache eviction
unloads JavaScript modules.

Factories already run once per session. Module-level variables in an
extension are shared by every session in the process that loads it, and so
are the providers it registers (section 5.2). `docs/extensions.md` gains a
paragraph under State saying so, and that per-session state belongs in the
factory closure.

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
type ToolCallApprovalParams = {
	threadId: string; turnId: string; itemId: string;
	tool: string; parentItemId?: string;
	reason?: string;                      // why this call needs a decision, when a gate gave one
	prefix?: string;                      // shell tools only: the command prefix `acceptPrefixForSession` would allow
	decisions: ("accept" | "acceptForSession" | "acceptPrefixForSession" | "decline")[];
} & ({ input: unknown } | { inputRef: PayloadRef });
type ToolCallApprovalResult =
	| { decision: "accept" | "acceptForSession" | "cancel" }
	| { decision: "acceptPrefixForSession" }
	| { decision: "decline"; message?: string };
```

An approval carries exactly one of inline `input` and oversized `inputRef`;
resolve the reference before presenting the decision. Both/none is invalid.

`decisions` lists what the client may answer; any other answer is treated as
`decline`. `cancel` is always allowed and never listed.

`acceptForSession` adds the tool name to the thread's allow set until the
thread unloads, as the engine's `allow_always` did. It is not offered for
`bash` and `powershell`: allowing the whole shell after one approval makes
`ask` mean nothing. Shell tools get `acceptPrefixForSession` instead:

- The rule fails closed: a prefix is offered only for a command form the
  server positively recognises, and anything else is approved whole or not
  at all.
- No prefix when the command contains, anywhere, a character that can chain,
  expand, quote, glob or redirect. In bash: `;` `&` `|` `` ` `` `<` `>` `(`
  `)` `{` `}` `[` `]` `$` `\` `'` `"` `*` `?` `!` `#` `~` and newlines. In
  PowerShell: `;` `&` `|` `` ` `` `<` `>` `(` `)` `{` `}` `[` `]` `$` `'`
  `"` `@` and newlines. So `git commit -m "fix"` is always asked about; the
  cost of a few extra questions is accepted.
- No prefix when the first word assigns a variable (`PATH=/tmp npm test`).
- The first word is classified by its program name: last path segment, lower
  case, without `.exe`, `.cmd`, `.bat`, `.com` or `.ps1`, so
  `C:\Python\python.exe` is `python` and `IEX` is `iex`.
- A wrapper that runs another command or changes how one runs (`sudo`, `env`,
  `xargs`, `find`, `timeout`, `nohup`, `source`, `.`, `exec`, `eval`,
  `Invoke-Expression`, `Start-Process`, …) never gets a prefix.
- An interpreter (`python`, `node`, `bash`, `sh`, `pwsh`, `cmd`, `npx`, `awk`,
  …) gets one only together with the script or module it runs (`python
  check.py`, `python -m pytest`, `npx cowsay`), and none when a flag comes
  first (`python -c`, `bash -c`, `cmd /c`) or the script is itself a
  dispatcher (`npx npm`).
- A nested target that is itself a dispatcher (a wrapper, an interpreter, or
  a multi-command tool such as `npm` or `git`) never ends a prefix: `uv run
  npm test`, `npx npm test` and `uv run git status` get none, because a
  prefix ending at `npm` or `git` would cover everything those can run
  (`uv run npm exec node ...`, `uv run git push`).
- A multi-command tool (`npm`, `pnpm`, `yarn`, `bun`, `git`, `cargo`, `go`,
  `dotnet`, `uv`, `make`, `docker`, `kubectl`, `gh`) gets its first two words
  (`npm test`, `git status`), none when a flag comes before the subcommand
  (`git -C . status`, `bun -e`), and three words when the subcommand runs a
  named script or package binary (`npm run build`, `go run main.go`, `uv run
  pytest`), none when that target is missing or is a dispatcher (`uv run
  python`, `uv run npm`). Which subcommands run a named target is listed per
  tool (`npm run`/`exec`/`x`, `pnpm` and `yarn` `run`/`exec`/`dlx`, `bun
  run`/`x`, `uv run`, `go run`, `cargo run`). Subcommands that run an
  arbitrary command inside something else (`docker run`/`exec`, `kubectl
  exec`/`run`/`debug`/`attach`, `dotnet exec`, `git submodule`, `gh
  extension`/`alias`) never get a prefix.
- `pip`, `pipx`, `poetry`, `pdm`, `hatch`, `conda` and `podman` are
  multi-command tools too (`pip install`, `poetry run pytest`; `podman
  run`/`exec` never), and `wsl`, `chroot`, `setsid`, `stdbuf`, `flock`,
  `pkexec`, `systemd-run` and `busybox` are wrappers.
- A program with no subcommands (`ls`, `cat`, `echo`, `grep`, `rg`,
  `Get-ChildItem`, … listed in the code) gets its first word, as written.
- Any other program might be a multi-command tool the lists miss, so it gets
  its first two words, never its name alone: `pip install` must not cover
  `pip uninstall`. None when the second word is a flag, missing or a
  dispatcher, and three words when the second is a generic runner
  subcommand (`run`, `exec`, `x`, `dlx`) followed by a named target.
- A later command matches an allowed prefix only if it would itself be
  offered exactly that prefix under these rules (case-insensitively in
  PowerShell). `npm test` allows `npm test -- --ci`, not `npm testx`, not
  `npm test && rm -rf build`, and not `PATH=/tmp npm test`; a stored prefix
  shorter than the command's own (`pip` against `pip uninstall`) never
  matches, whatever produced it.
- The lists are the residual risk, but a gap in them narrows a prefix rather
  than widening it: a name missing from the no-subcommand list only makes its
  prefix longer. What remains is a program that runs other code through an
  unlisted, non-generic subcommand (`mytool shell`). Adding a name to the
  wrapper, interpreter, multi-command or dispatching-subcommand lists is
  always safe. Approving a script runner (`npm run build`) trusts that
  script's current and future content, which the agent can edit; the user
  approves it by name.
- The prefix set lives with the tool allow set and ends with it.

`decline` with `message` blocks the call with "The user rejected this tool
call: <message>", so the model learns what to do instead.

`reason` names a fact that makes this call riskier than its tool suggests. The
gate sets one: "Writes outside this thread's workspace" for an
`edit` or `write` whose path resolves outside the thread's cwd. Gates that
block (plan mode, the classifier) are unchanged and never produce a request.

The mode is a property of the thread, stored as a custom entry
`knightcode.approvalMode`. The effective mode is written when a thread is
created (`thread/start`, `thread/fork`, a replacement), whether the client
named it or the default applied, and again on every change. Without that, a
desktop thread created with the default `ask` would resume as `fullAccess`
in the terminal. Default: `ask` for a thread the desktop app starts,
`fullAccess` for one the terminal CLI starts, which is today's terminal
behaviour (confirmed 2026-10-11).

Restoring fails closed. The latest entry on the branch decides; a value that
is not one of the three modes restores as `ask`. A thread with no entry
(written by the terminal before Phase D) takes the resuming connection's
default and writes nothing until the mode changes.

Nested calls (code mode) reach the gate through `_beforeToolCall`'s
`parentToolCallId` and carry `parentItemId`.

### 5.5 Session lock

A live session holds a `proper-lockfile` lock on its session file, with
`stale` and `update` set so a crashed holder's lock goes stale. A load that
finds the lock held answers `threadLockedElsewhere`; `thread/read` still
works, as it needs no lock. An in-memory thread (tests, `--no-session`)
takes no lock.

The lock lives in `SessionManager`, not `LoadedThread`: it is taken when the
manager binds to an existing file (`open`, `continueRecent`, `forkFrom`, the
constructor) or selects a new destination path, before any write, and
released by a new `close()`.
Today's terminal opens session files from nine call sites in `main.ts` and
`agent-session-runtime.ts`, and keeps doing so until Phase D; a lock only the
app server took would let the desktop app and the terminal append to one file
in the meantime. `AgentSession.dispose()` calls `close()`, which covers the
runtime's session switches, `LoadedThread` unloads and SDK callers alike.

Lock identity is the canonical filesystem path, not `resolvePath` alone.
Resolve existing files with `realpathSync.native`; for a not-yet-created
file, resolve its existing parent directory first and append the basename.
Use that same canonical path for the process-local count, lock directory,
owner token, guarded refresh/cleanup, and manager binding. Normalize Windows
case for the map key only. Passing `realpath: false` to `proper-lockfile` is
safe only after this canonicalization. A file symlink, directory symlink or
Windows junction must not grant a second lock. Reject dangling symlinks.
Hard-link aliases do not have one canonical path: refuse an existing
transcript with `nlink > 1` rather than claim inode-wide ownership. Locks are
advisory among cooperating processes; external link/path replacement is not
an OS sandbox guarantee.

The contract:

- Writers own the file. Every path that writes the file or moves the tree
  checks the manager is open and its lock is held, before it changes memory
  or disk: every `append*` (through `_appendEntry`), the first flush, the
  rewrite after migration, an empty file's header, `newSession`,
  `setSessionFile`, `createBranchedSession`, and the leaf moves `branch`,
  `resetLeaf` and `branchWithSummary`. A leaf move writes nothing itself, but
  the next append builds on it, and `branchWithSummary` used to move the leaf
  before its append could refuse. A rejected call leaves the leaf, the
  entries and the file as they were.
- A new file is locked before it is discoverable. `forkFrom` takes the lock
  on the destination path, then writes header and copied entries in one
  `wx` write, then builds the manager (which counts onto the same lock). A
  listing or a terminal can find the file only after it is locked and
  complete. A failure removes the file it created and releases the lock.
  A fork at an item writes only the path to that entry (`forkFrom`'s
  `leafId`), so there is never a full intermediate copy to delete, and an
  unknown item is rejected before any file exists.
- A switch to a new file keeps one order: canonical path, new lock, the old
  lock's release, then memory and the rewrite. A refused lock changes
  nothing; a failure after that closes the manager (see below). A write also
  checks that the held lock is for the current path, not merely that some
  lock is held.
- `close()` is final. A closed manager stays readable and rejects every
  write with `SessionClosedError`; reopening is a new manager. Otherwise a
  closed manager whose file another process has since opened would append
  without the lock.
- Reading needs no ownership and never writes. `loadEntriesFromFile` (used by
  `thread/read`, `forkFrom` and the source side of a fork) only reads. The
  one repair, adding the newline a crash left off the last line, happens in
  the manager after it takes the lock.
- A failure after the lock is taken (an invalid header id, a file that is not
  a session) releases it before the error leaves the constructor. The same
  failure on an existing manager's `setSessionFile` permanently closes that
  manager before propagating the error; callers must open a new manager.
  An acquisition failure before rebinding leaves the original manager and
  lock intact. No caught failure leaves a writable manager without a lock.
  The write guard treats a selected persisted path without a held lock as
  lost ownership, even if no compromise flag was set.
- Within one process the lock is shared and counted: the runtime's fork path
  opens a second manager on the live file for a moment. Each acquisition gets
  its own handle; releasing an old handle never touches a newer acquisition
  of the same file.
- An acquisition is complete only once its token is written. If writing
  `<file>.lock-owner` fails after the lock directory was taken, the
  acquisition gives the directory back (stopping its refresh timer) before
  it throws, so a failed acquisition never leaves a held lock.
- Ownership is checked synchronously, not taken from a flag. A refresh timer
  alone cannot enforce it: if this process's event loop stalls past the
  stale threshold and another process takes the expired lock, this process
  could append, or release and delete the other's lock directory, before
  its next refresh notices. So each acquisition writes a random token to
  `<file>.lock-owner`, and every write and every release reads it back
  first; a different token means the lock is lost, and the manager rejects
  writes with `SessionLockLostError`. Releasing a lost lock touches nothing.
  The token sits beside the lock directory, not in it, because
  `proper-lockfile` removes a stale lock with a plain `rmdir`. The app server
  unloads a thread whose lock was lost, with an `error` notification, when
  its turn ends.
- The check covers the library's own paths, not only ours. `proper-lockfile`
  also removes every lock it still tracks when the process exits, and its
  refresh timer touches the lock directory's mtime, both without knowing
  about the token. A probe showed the result: process A holds the lock, B
  takes it over after A stalled, A notices, releases and exits, and B's lock
  directory is gone. So each acquisition hands `proper-lockfile` its own
  `fs` (the library's documented `fs` option) whose `rmdir`, `rmdirSync` and
  `utimes` first compare the token: on another holder's token, removal does
  nothing and a refresh fails as if the directory were gone, which reports
  the lock compromised and lost. Release, exit cleanup and refresh all go
  through it.
- Limit, stated rather than hidden: a takeover that lands between the check
  and the append itself (microseconds) is not prevented. Closing that gap
  would need the filesystem to arbitrate every append, which neither POSIX
  appends nor Windows give without a lock held across the write. The same
  window exists between a new holder's `mkdir` and its token write: a stale
  holder's refresh landing there touches the new directory, and the new
  holder's next refresh then reports its own lock lost. Both stop writing;
  nothing interleaves.
- A sleeping laptop is not a takeover by itself. `proper-lockfile` renews a
  refresh that runs late as long as the lock directory's mtime is still its
  own. It reports a compromise only when the refresh fails (the lock
  directory was deleted) or finds another holder's mtime. On a deleted
  directory the lock is taken again at once; on another holder's mtime the
  re-take fails and the lock is lost.

When the terminal hits a held lock (`SessionManager` throws before Phase D,
`threadLockedElsewhere` after), it says the session is open in another
KnightCode process and offers to continue in a fork, which reads the source
file and needs no lock on it. Declining exits with a non-zero status. The
desktop app's answer to the same error belongs to the desktop
specification.

### 5.6 Thread lifecycle and memory

Load de-duplication alone leaves races. Two examples: an idle unload removes
the thread from the map, then awaits disposal; a `thread/resume` arriving in
between finds no thread, opens the file again and builds a second session
while the first still owns it. And two `turn/start`s can both pass an
`isStreaming` check while the first is still in preflight.

So each thread id is in at most one of three states in the `ThreadManager`:

| State | Held in | A new request for the id |
| --- | --- | --- |
| loading | `loading: Map<id, Promise<LoadedThread>>`, every build by id, whoever started it | waits for the same load |
| loaded | `threads: Map<id, LoadedThread>`, `state: "ready"` | uses it |
| closing | `closing: Map<id, Promise<void>>` (unload, archive move) | waits for it to finish, then loads again |

Every route to a saved thread goes through one function, `ensureLoaded`:
`thread/resume`, one-off changes on an unloaded thread, `turn/start`, and an
existing target of a session replacement. Every session build, whichever
path started it, is also entered in `loading` under its id: a fork's file
exists before its load finishes, so `thread/list` can show it, and a resume
of that id must join the build rather than open a second session (the
in-process lock is counted and would allow one), while an archive waits for
it. Every load operation of any kind
(start, resume, fork, a replacement's new session) is tracked from its first
step, so shutdown waits for it: a resume spends its first await finding the
file, before any session exists, and a shutdown that only counted sessions
under construction would return while that resume goes on to take the lock.

Unload and archive share one closing transition. It reserves the id in
`closing` at once, so every later request for the id waits. Then it waits
for a load of that id already under way, and only then takes the thread out
of `threads` and runs its step. Without the wait, this race leaves a session
pointing at a moved file: a resume opens the manager and parks in an
extension factory; an archive sees no ready thread, takes the file's lock
(the process-local counted lock lets it), and moves the file; the resume
finishes with a manager on the old path. With it, the archive disposes the
freshly loaded thread before it moves the file. A resume whose response is
written after that sees a thread no longer ready and answers
`threadNotFound`. The `closing` entry is a settled promise that is stored and
later compared by identity, so a finished transition always clears it.

Inside a loaded thread, operations that must not interleave run one at a
time on the thread's queue (`LoadedThread.exclusive`):

- `turn/start`, up to the end of preflight. A second `turn/start` waits for
  the first's preflight, then sees the running turn and answers
  `turnInProgress`.
- `thread/compact`, which also needs the thread idle and answers
  `turnInProgress` otherwise.
- `thread/settings/update`, which does not need idle: it applies from the
  next model request, also mid-turn.

`turn/interrupt` and `turn/steer` do not wait in this queue: they act on the
running turn. `turn/queue/add` holds its input in the thread's own list until
the thread is idle, then starts it through the same `turn/start` path.

Preflight can wait on an authentication check, asynchronous `input` or
`before_agent_start` hooks, or an extension command. Each `turn/start` gets an
abort controller as soon as its thread is loaded, before it queues and before
the first await of preflight; `turn/interrupt` and unload abort every such
controller. The harness carries no signal (section 4.7); the server stops a
start at these points:

- its own auth check, re-checked after the await;
- the `input` event: the hidden `app-server-start-guard` extension loads last
  and answers `handled` once the start that owns the thread's running
  `prompt()` (`LoadedThread.dispatching`) is aborted. A command's
  `ctx.sendUserMessage` prompts through the same input handlers, so
  `/plan <task>` interrupted while the command runs launches nothing either;
- session replacement: `newSession`, `fork` and `switchSession` read the
  dispatching start's signal and back out before publishing;
- the run's own preflight: from `_startRun` on the session is busy, so
  `session.abort()` aborts compaction and stops the run at `agent_start`.

Interrupted before the run exists, `turn/start` answers
`{status: "cancelled", threadId, requestId}` at once and no `turn/started`
follows; hooks already running finish in the background while the start still
holds the thread's queue. Interrupted during the run's own preflight, it
answers `started` and the turn completes `interrupted` without a model
request. A command/input hook that handles it without a run answers
`handled`, not `cancelled`. The core's `PromptDisposition` does not change:
RPC mode returns it and section 12 excludes RPC changes. The initiating start
is request-owned with a mutable thread owner (section 4.5), so disposing a
replaced thread never cancels its forwarded prompt. Out of reach:
`knightcode.sendMessage(..., {triggerTurn: true})` is the extension API, not
tied to one command dispatch, so a run it starts after the interrupt runs;
`turn/interrupt` stops it like any other run.

A thread is busy while a request holds it (queued or running operations,
one-off changes), or while the session is not idle (`!session.isIdle`: a
run, a compaction, a branch summary). A thread with no subscriber that is not
busy starts a 10-minute timer; the timer re-checks both before it unloads.
Unload: cancel every start not yet launched, release pending requests as
cancelled, `session.abort()`, wait for the thread's queue to drain
(operations queued but not started fail at once), `session_shutdown` with
reason `quit`, `dispose()` (which releases the lock), broadcast
`notLoaded`. A replacement skips the queue wait: its caller is a command
running on that queue. This is the engine's `close()` order
(`sessions.ts:325-339`). `turn/start` or `thread/resume` on a `notLoaded`
thread loads it again.

A connection that closes while a load it asked for is in flight is not
subscribed when the load finishes; the thread then idles like any other.

Shutdown (`closeAll`, on stdin EOF or a signal): new loads are refused with
`shuttingDown`, every tracked load operation is awaited and then unloaded
with everything else, and every unload runs in parallel. `knightcode
app-server` starts a 10-second timer the moment stdin ends or a signal
arrives, not when output finishes draining, and the timer calls
`process.exit` whatever is still pending: `closeAll`, the final flush, or
output a client stopped reading. An abort also drops output still queued in
the transport.

End of input is not end of output. A client may write a request and close
its side at once (`echo '{...}' | knightcode app-server`), and a handler that
was still awaiting when stdin ended must still be able to answer. So EOF
stops reading and starts shutdown, and the connection closes its output only
after every request it accepted has been answered. Accepted requests finish
or fail, never vanish: shutdown cancels what it must (a start in preflight
answers `cancelled` with its effective thread and request token, a load
answers `shuttingDown`), and each answer is written.
Server requests to that connection (approvals) are withdrawn from it at EOF
as on a disconnect, since no answer can arrive, and the connection takes no
new subscriptions.

### 5.7 Turns

`turn/start` calls `session.prompt()` with the engine's preflight pattern
(`sessions.ts:531-561`) inside the thread's queue: the request resolves once
preflight passes, and the outcome is `turn/completed`. `turn/steer` calls the
session's `steer()`. After every activity ends (a settled run, a released hold)
the thread starts its oldest queued input if nothing else runs, one at a time.
`turn/interrupt` drops the queued inputs, cancels every
start not yet launched (section 5.6), aborts pending client requests and
calls `session.abort()`; the end entry records the abort as `interrupted`.

### 5.8 Archive

`SessionManager` has no archive concept. `thread/archive` unloads the thread
if loaded, then moves its session file into an `archived/` directory inside
its session directory; `thread/unarchive` moves it back. Both paths are
protected: create/canonicalize the destination directory, acquire source
and destination locks in canonical sorted order, verify the source header
id, and reject an existing destination with `archiveConflict` (including an
existing same-id file). Publish without replacement using same-filesystem
`link(source, destination)` then `unlink(source)`, not overwrite-capable
`rename`. Retain both locks through publication and path-index update. If
unlink fails, remove only the destination link this operation created while
both locks are still held; report any failed rollback explicitly. Refuse a
symlink source rather than unexpectedly move its target or break a relative
link. A crash between link and unlink can leave two names for one inode.
The lock refuses such a file with `SessionHardLinkedError`, and a load
answers `archiveConflict` with `data: {reason: "duplicateLinks", paths,
recoveryInstructions}` listing every name whose header carries the id; it
opens and deletes nothing. Never delete an unrelated file.
The move counts as closing (section 5.6), so a resume racing it waits and
then finds the file at its new path instead
of creating an empty session at the old one. `thread/list {archived: true}`
lists that directory, so the default listing never reads archived files.
Worktree threads add section 6.1's cleanup.

Finding a thread's file goes by the id in its header, not its file name: an
imported or renamed transcript keeps its header id under another name
(`SessionManager.findById` already reads headers for this reason). The thread
manager remembers each id's path and re-reads the header to confirm it; a
miss scans the session directories.

### 5.9 Transport limits

- A stdin line longer than 64 MiB (images arrive base64 inside
  `turn/start`) is dropped up to its newline, and the server answers an
  `error` notification. The connection stays open.
- Output the client is not reading is bounded too: when more than 64 MiB of
  written lines are still waiting on stdout, the client is treated as gone
  and the connection is aborted. The in-process transport closes both ends
  when a queue passes its capacity.
- Valid transcript reads must not hit those limits merely because a turn
  contains large media, text or tool arguments. Inline `Item` and `Turn`
  values are limited to 64 KiB of serialized UTF-8 JSON. Larger values use
  immutable `ItemReference` / `TurnReference`; the id and item kind or turn
  status remain available without reading the payload. `turn/completed`
  carries only `TurnSummary`, never the turn's items again. Summary/reference
  error previews are capped at 2,000 Unicode code points; the full error is
  retained in the referenced/read-back turn. Text/reasoning
  deltas are split at Unicode boundaries into at most 48 KiB UTF-8 chunks;
  oversized tool-output updates and approval input use `PayloadRef` too.
- `payload/read` validates an issued opaque id and a non-negative byte
  offset, and returns at most 48 KiB of source bytes (base64 on the wire).
  `maxBytes` defaults to 48 KiB and must be 1..49152. Offsets are bytes;
  clients concatenate decoded bytes before UTF-8 decoding/JSON parsing.
  Unknown or expired ids answer `payloadNotFound`; never resolve an id as
  a filesystem path. Spool large JSON incrementally to process-private
  temporary files, not another unbounded in-memory queue. Snapshot data is
  frozen synchronously before reference publication; a chunk read awaits
  completion of the asynchronous spool, without blocking notification/chunk
  response dispatch. Spool failure returns an actionable `internal` error,
  not a partially readable JSON document. References lease
  their files for 30 minutes, renewed by reads; expiry and shutdown remove
  them. A resume/read regenerates expired references. On restart, clean only
  orphaned payload directories whose owning process is confirmed gone.
- History pages are capped at 1 MiB including the envelope; individual
  oversized turns are referenced, so a page always makes progress. Reference
  issuance and snapshot freezing precede subscription commit. Pending-output
  limits still protect against a genuinely slow client, not normal page size.
- Both limits count UTF-8 bytes, not JavaScript string length: a line of
  non-ASCII text is up to three times longer in bytes than in UTF-16 code
  units. The reader splits raw bytes at `0x0A` (a UTF-8 continuation byte is
  never `0x0A`, so a split never cuts a character) and decodes each whole
  line once.
- End of input does not close output (section 5.6). `close("drain")` is the
  only path that ends output gracefully.
- `close("drain")` delivers what was already sent, then closes;
  `close("abort")` drops it. Overflow aborts.
- There is no limit on requests in flight per connection: the clients are
  the desktop app's main process and the terminal, which pace themselves.

### 5.10 Listing index

Section 13 measured what a full-transcript scan costs: 105 MB read and up to
31.6 s for an initial `thread/list` of 10,000 sessions on Windows, on every
app start. Almost all of those files had not changed since the last listing.

Each session directory gets `.thread-index.json`, a cache of what a listing
needs per file:

```ts
interface ThreadIndex {
	version: 1;
	entries: Record<string, {            // key: file name
		size: number; mtimeMs: number;   // the file's stat when it was summarized
		session: {                       // null: a .jsonl that is not a session
			id: string; cwd: string;
			title: string;               // the display title, at most 201 code points (titleOf)
			forkedFromId?: string;       // the parent's header id, read once when the fork was scanned
			created: string; modified: string; messageCount: number;
		} | null;
	}>;
}
```

An entry stores the listing summary only, never the first message or any
message text: a transcript whose first message is 100 MiB gives an entry of a
few hundred bytes.

- An initial `thread/list` reads the directory and stats every transcript,
  which reads no file contents. An entry whose size and mtime match is used
  as is; a new or changed file is scanned as today and its entry replaced; an
  entry whose file is gone is dropped.
- If anything changed, the index is written to a temporary file in the same
  directory and renamed over the old one. A rename cannot be half-done, so a
  reader sees the old index or the new one.
- The index is a cache, never the source of truth. A missing, unparsable,
  other-version or oversized (over 16 MiB, refused unread) index means a full
  scan and a rewrite. Each entry is checked against a schema that rejects
  unknown properties, its dates must parse and its title must be at most 201
  code points; an entry that fails, even in an index that is valid JSON, is
  treated as missing and its file rescanned. Records are rebuilt from the
  named fields only, so nothing else in the file reaches memory. Loading a
  thread still confirms the id from the file's header (section 5.8).
- A fork's parent is identified by the parent's header, never by its file
  name, which an imported or renamed transcript can make misleading. The
  header is read when the fork is first scanned (at the parent's path, or its
  `archived/` sibling, since archiving moves files without renaming them) and
  cached as `forkedFromId`; a warm listing opens no transcript, parents
  included. The listing counts every transcript and parent header it opens
  (`server/diagnostics`), so this is measurable.
- Writing the index is best effort: the listing is computed first, and a
  failed write (read-only directory, rename refused) is ignored after removing
  the temporary file. It only costs a rescan next time.
- Concurrency is bounded across the whole listing, not per directory:
  directories are listed one after another, each with at most 64 transcripts
  open at once.
- Two processes (the desktop's server and a terminal) may each rewrite it.
  The last rename wins; both indexes are derived from the same files, so the
  cost of a lost update is one more scan of the files it missed.
- The archive directory has its own index. A move between the two (section
  5.8) needs no index update: each side's next listing sees the change by
  stat.

Acceptance (section 13): a second initial listing of 10,000 unchanged
sessions reads zero transcript bytes and opens zero transcripts.

---

## 6. Workspaces, diffs and git

### 6.1 Worktree or local

Workspaces follow the Codex desktop app, checked by driving it on 2026-10-17
and against Codex's open-source worktree crate (Phase B plan, "Codex
parity").

`thread/start` takes `workspace`:

- `{mode: "local"}`: the thread runs in `cwd`. A `cwd` inside a managed
  worktree is a new thread in that worktree (Codex's "New chat in this
  worktree").
- `{mode: "worktree", baseRef?, carryLocalChanges?, environment?}`: a new
  git worktree on a **detached `HEAD`** at `baseRef`'s commit (default: the
  project checkout's `HEAD`). No branch is created; "Create branch here"
  (`git/branch/create`) or a handoff makes one. The base is stored as a SHA,
  never a branch name, so later diffs against it keep showing the same change
  set. The thread's cwd is the worktree, or the same subdirectory of it when
  the project cwd is a subdirectory of the repository.

Worktrees live in `<root>/<bucket>/<repoName>`: `root` is the user's
`worktrees.root` setting (default `<agentDir>/worktrees`), `bucket` four
random hex digits, `repoName` the repository folder's name. A manifest,
`<root>/<bucket>/worktree.json`, is written before the worktree exists and
names the project, the base SHA, the owner thread, the environment, and where
handed-off threads run. A thread's workspace is derived from its cwd and that
manifest: a session file is written only after the first message, and every
path that creates a session (start, fork, resume, an extension's
`newSession` or `fork`) already passes the cwd. The bucket and its manifest
outlive a deleted checkout, so a deleted worktree can still be described and
restored.

The checkout is created with `git worktree add --detach --no-checkout` and
filled with `git reset --hard`, with hooks, fsmonitor and every configured
filter disabled and Git LFS smudging off, as Codex's crate does. No user code
runs while a worktree is made, so a failed creation is rolled back completely.

`carryLocalChanges` applies the project checkout's uncommitted changes
(staged, unstaged and untracked; not ignored files) to the new worktree as
uncommitted edits, as Codex does for a branch "with local changes". The
user's checkout is only read.

A worktree's trust is its project's (keyed by the worktree path, every new
worktree would ask again); its settings files are its own committed
`.knightcode/`, like any checkout's. The default session directory is
derived from cwd (`session-manager.ts:580`), so a worktree thread's session
file goes in the project's session directory instead, and
`Thread.projectCwd` names the project. A cwd outside a git repository
supports only `{mode: "local"}`; worktree mode answers `notGitRepo`.

#### Environments and `.worktreeinclude`

A project's environments are in `.knightcode/environments.json`, which can
be committed: each has a name, a setup script and a cleanup script (each with
`default`, `macos`, `linux` and `windows` variants; the platform's variant
wins) and actions for the desktop's toolbar. `environment/list` and
`environment/save` read and write the file; a worktree start or handoff
names one environment or none (Codex's "Work without environment").

- The setup script runs when the worktree is created, at the project root,
  with `KNIGHTCODE_SOURCE_TREE_PATH` (the checkout the worktree came from)
  and `KNIGHTCODE_WORKTREE_PATH` (the new worktree) in its environment,
  through the platform shell with an argument array and a 10-minute timeout.
  Its output streams as `thread/workspace/progress {threadId, phase:
  "setup", output}` to the connection that started the thread. A failure
  keeps the worktree and the thread, sets `workspace.setupFailed: true`, and
  returns the thread with the last 4 KiB of output in a `warning`.
- The cleanup script runs at the project root before a worktree is deleted,
  with the same variables; a failure is a warning and the deletion proceeds.
- An untrusted project's environment never runs (section 5.2); the start
  continues without setup and carries a `trust` warning.
- Git-ignored files are not copied into a worktree unless the repository
  root's `.worktreeinclude` (gitignore syntax) lists them, such as `.env`. A
  file is copied only if the worktree ignores it too, and nothing is ever
  created through a symlink or junction.

#### User settings

```ts
interface WorktreesSettings { // the `worktrees` member of the global settings file
	root?: string;              // absolute; default <agentDir>/worktrees
	autoDelete?: boolean;       // default true: archive deletes, and old worktrees are pruned
	keep?: number;              // default 15: managed worktrees kept before the least recently used are pruned
	fetchBeforeCreate?: boolean; // default false: fetch the base's upstream before each new worktree
	branchPrefix?: string;      // default "kc/": handoff branch names
}
```

#### Handoff

`thread/handoff {threadId, to: "local" | "worktree", branch?, environment?, dryRun?}`
moves a chat and its uncommitted changes between its worktree and the main
checkout (Codex's "Hand off", whose dialog reads "Check out branch … in a
local workspace and detach it from worktree."). Each chat keeps its worktree,
so a handoff back returns it there.

1. Both checkouts are reserved (no turn starts and no tool runs in either)
   and must have no merge, rebase, cherry-pick or revert in progress. The
   destination must be clean: nothing staged, no tracked change, no untracked
   file that is not ignored, and no ignored file where the handoff writes a
   file (git's checkout would overwrite it). Otherwise `gitConflict` with
   `data.reason: "localChanges"` and "Stash or commit your local changes to
   hand off."
2. The source's uncommitted changes are captured as one binary patch and
   saved under `<agentDir>/handoff/` before anything moves.
3. To local: the worktree's `HEAD` becomes a branch checked out in the main
   checkout: the worktree's own branch (then the worktree is detached first,
   since git checks a branch out in one place only), else the requested name,
   else `<branchPrefix><title-slug>`; the previous handoff's branch is
   fast-forwarded instead when it is still checked out there. To worktree:
   the worktree is detached at the main checkout's `HEAD`, which stays on its
   branch; a thread born in the main checkout gets a new worktree.
4. The patch is applied in the destination, then reverse-applied in the
   source; the changes leave the source only after they landed. A failure to
   apply answers `recoveryRequired` naming the saved patch, with the source
   untouched.
5. The thread is reloaded where it now runs; its session header keeps its
   original cwd, and the manifest records where it runs.

The handoff runs no hooks and creates no commit: it moves the user's own work.
A chat with no message yet has no session file to reload and is not handed
off.

`dryRun` runs steps 1 and 3's checks (the reservations it only checks, the
branch choice with its name check) and answers with the same refusal, or with
the thread and the branch the main checkout would get. It writes nothing, not
even a manifest or a worktree, and holds no reservation, so a real handoff is
never kept waiting by one. Codex's handoff dialog checks before the user
confirms; the desktop's does the same with this, on open and 250 ms after each
branch edit.

#### Deleting and restoring worktrees

Archiving a thread deletes its worktree, and when there are more managed
worktrees than `worktrees.keep` the least recently used are pruned, as in
Codex; `worktrees.autoDelete: false` turns both off, and `worktree/delete`
deletes one from the settings list (`worktree/list`). A worktree another
thread is loaded or loading in, or that a reservation holds, is never
deleted, and neither is one another unarchived thread uses on archive, one
that is still being prepared, or one with an initialized submodule (the
snapshot would record only its gitlink, not the files inside it).
Deletion commits a snapshot first: the worktree's tracked and untracked
files (not ignored ones) as a commit whose first parent is the worktree's
`HEAD` and whose second parent holds the staged state, kept under its own
ref, `refs/knightcode/snapshots/<bucket>/<time>`, and recorded in the manifest
before the checkout is touched. A removal that fails part-way keeps that
snapshot and is finished, not snapshotted again, on the next attempt. Then the environment's cleanup script runs
and `git worktree remove --force` removes the checkout; installed
dependencies and other ignored files go with it. Only registrations in the
managed layout whose `.git` file points back to them are removed; there is no
repository-wide `git worktree prune`, so the user's own worktrees and stale
registrations are never touched.

Resuming a thread whose worktree was deleted answers `gitConflict` with
`data.reason: "worktreeDeleted"`; `thread/read` still works.
`thread/worktree/restore` rebuilds the worktree at its old path from the
snapshot: detached at the old `HEAD`, with the working files and the staged
state exactly as they were.

`thread/fork` takes `workspace` too: absent, the fork shares the source's
workspace (Codex's "Fork in this worktree"); `{mode: "worktree"}` gives it a
new worktree at the source checkout's `HEAD` carrying the source's
uncommitted changes ("Fork in a new worktree"). `ThreadSummary.workspaceMode`
marks worktree threads in listings without loading them.

Serialize mutating app-server git operations per repository (its common git
directory), not per thread: a worktree and its main checkout share refs, and
one queue needs no lock ordering. The queue cannot stop an editor or an
external git process from writing; each mutation re-checks what it depends
on and answers `gitConflict` with `data.reason: "concurrentChange"` rather
than overwrite.

### 6.2 Diffs

| Method | Behaviour |
| --- | --- |
| `thread/diff/read {threadId, scope?, against?, commit?, context?, ignoreWhitespace?}` | `scope`, Codex's Changes sources: `lastTurn` (the last turn that changed files, before to after), `uncommitted` (`HEAD` to working tree; the default), `unstaged` (index to working tree), `staged` (`HEAD` to index), `committed` (one `commit`, from `git/log`), `branch` (the merge base with `against` to working tree; `against` defaults to the worktree's `baseRef`, else the upstream, else the default branch). `ignoreWhitespace` is Codex's "Hide white space". Files, hunks with content-hash ids, line ranges, binary flag; `context` lines around each hunk (a large value gives whole files). With more than 500 untracked, not ignored files it returns tracked changes only and `untrackedSkipped: <count>`, so a missing `.gitignore` entry for a build directory cannot stall the call. The serialized response stays within a fixed budget: files past it come without hunks (`tooLarge`), or are only counted (`filesOmitted`). Without `ignoreWhitespace` it names the two trees it compared, `fromTree` and `toTree` (snapshots for the working tree and the index), for `thread/diff/file` |
| `thread/diff/file {threadId, fromTree, toTree, path, oldPath?}` | `{old?, new?, binary, tooLarge}`: one file's two sides from a read's trees (`git cat-file blob <tree>:<path>`), so the Changes pane expands the unchanged lines between hunks against exactly what the read compared. A tree must be a full object id naming a tree in the repository; a side above 2 MiB gives `tooLarge` and no text, a NUL in the first 8 KiB `binary` |
| `thread/diff/revert {threadId, scope?, against?, path?, hunkId?, context?, reapply?, turnId?}` | reverse-applies one hunk, one file, or the whole scope to the working tree; `lastTurn` without a path undoes the turn, and `reapply` applies it again (Codex's Reapply). With `turnId` (`lastTurn` only) a newer last turn answers `gitConflict` `diffChanged`. A hunk that changed since it was read answers `gitConflict` `diffChanged`. Refused while a turn runs |
| `turn/start`, `turn/queue/add` with `comments` | review comments are drafts the client keeps (Codex: "Local comment on line R2", a "1 comment" chip) and sends with the next input; the server quotes each comment's lines from its scope's trees into the text the model reads, and the user item shows the comments, not that text |

`turn/diff/updated {threadId, turnId, files}` follows `turn/completed` when
file contents changed while the turn ran (attribution below). Tool calls'
`fileChanges` alone would miss files written by `bash`, `powershell` and
code mode. `git status` output is not enough either: editing a file that is
already modified leaves its status line unchanged, so a second turn's edits
would go unreported.

Detection snapshots the working tree's content as a tree object, without
touching the user's index:

1. Copy the repository's index (`git rev-parse --git-path index`) to a
   temporary file, so the stat cache makes the next step incremental.
2. With `GIT_INDEX_FILE` set to the copy: `git add -A`, then `git
   write-tree`. The tree id names every tracked and untracked, not ignored,
   file's content.

Taken before the turn's first tool call (files change only through tools;
a hidden `tool_call` handler after the approval gate awaits it) and after
the turn settles, one snapshot at a time per thread; when the two tree ids
differ, `files` is `git diff --name-only <before> <after>`, and the pair is
stored as a `knightcode.turnDiff` custom entry so `lastTurn` reads back after
a reload. That
names every file whose content changed during the turn, including a second
edit to a file that was already dirty.

Untracked files in the snapshots: all of them up to 500 (each over 10 MiB
left out). Past 500, an untracked folder that holds 200 or more untracked
files itself is left out with everything under it (Codex's ghost snapshots'
rule), and the after-snapshot leaves out the same folders as the before one,
so a turn that empties one below 200 does not read as adding the rest, plus
any large folder the turn made (none of whose files the before one kept). Each
snapshot also writes the tracked files' tree; when more than 500 untracked
files remain outside such folders on either side (a turn that installs
dependencies with no `.gitignore` entry), the two tracked trees are compared,
so the turn's tracked edits are still recorded. The listing is streamed,
never collected. On this repository (12,345 untracked files, 12,198 in seven
frame folders) that keeps a new file in the checkout's root in the record:
the listing takes about 125 ms and the 147 remaining files about 250 ms to
hash. The diff reads keep the plain rule below: tracked changes only past 500.

What it does not do is attribute: a snapshot covers the whole working tree,
so a change another local thread in the same checkout made during the
overlap, or one the user made in an editor, is in the list too. So
`turn/diff/updated` means "files that changed while this turn ran", and the
protocol and the desktop UI say so. Exact per-turn attribution needs
isolation: a worktree thread's `files` are its own (apart from edits the
user makes in that worktree), unless a second thread was started inside the
same worktree, whose edits during the overlap it can include. Two
local threads in one checkout cannot be told apart, and Phase B does not
try; `fileChanges` on tool calls remains the exact record of what the
`edit` and `write` tools did.

Outside a git repository there is no `turn/diff/updated`, and `thread/diff/*`
and `git/*` answer `notGitRepo`. Tool calls still carry `fileChanges`.

### 6.3 Git

`git/status {threadId}` (branch, upstream, ahead/behind, staged/unstaged/
untracked counts, an operation in progress), `git/stage`, `git/unstage`
(`{threadId, path?, hunkId?, context?}`), `git/commit {threadId, message?,
includeUnstaged?}` (Codex's "Include unstaged changes", on by default),
`git/push {threadId}`, `git/pr/create {threadId, title?, body?, draft?}`,
`git/branches`, `git/branch/create {threadId, name}` (Codex's "Create branch
here"), `git/branch/switch {threadId, name}` and `git/log {threadId,
limit?}` (the commits since the base, for the Committed source).
Each acts on the thread's own checkout: its worktree, or the user's checkout
for a local thread.

An empty commit message asks the thread's model for one from the staged diff,
outside the conversation. `git/pr/create` runs `gh pr create`; without `gh`
on PATH it answers `toolMissing`.

Every git call is `spawn("git", args, {cwd})` with an argument array. No
shell strings, so quoting is identical on Windows.

---

## 7. The terminal CLI on the app server

### 7.1 Slices

`InteractiveMode` gets an `AppServerClient` over the in-process transport.
Each slice moves one group of actions (everything that changes a session)
from direct session calls to protocol calls and leaves the CLI working; reads
and live events stay in-process through local handles (section 7.3):

1. Turn lifecycle: `prompt`, `steer`, `followUp`, `abort`, queue clearing.
   The TUI keeps rendering from the session's own events.
2. Model, thinking level, scoped models, settings.
3. Session tree: navigate, fork, clone, compact, rename, export, import,
   new, resume.
4. `!` bash, slash commands, prompt templates, retry, cache warming.
5. The remaining actions extensions run through their command context.

Print mode and `--mode json` do not move: they stay on the direct session,
identical to the reference engine, as RPC mode does (user, 2026-10-23).

The TUI reaches the server through a session facade, `RemoteSession`
(`modes/interactive/remote-session.ts`), that `InteractiveMode` uses where it
used `AgentSession`, so the TUI's renderers and components do not change
(v1-completion-plan.md D11 and Phase D).

Done means: `rg -n "AgentSession\b|AgentSessionRuntime\b"
packages/cli/src/modes/interactive` matches only `remote-session.ts`.

### 7.2 Methods the terminal adds

Added as their slice needs them, each documented in section 4.4's table when
it lands: `thread/tree/navigate`, `thread/clone`, `thread/export`,
`thread/import`, `thread/settings/update` fields for scoped models, steering
mode, follow-up mode, auto-compaction, auto-retry and cache warming,
`turn/queue/clear`, `turn/retry/abort`, `shell/exec` and `shell/abort` for
`!` commands. The TUI reads the tree, context usage and the complete session
statistics (`getSessionStats()`, message and tool counts included) through
local handles, not through `TokenUsage`, which has no counts.

### 7.3 Local handles

Some things cannot cross a process boundary: component factories
(`setWidget` with a factory, `setHeader`, `setFooter`, `custom`,
`onTerminalInput`), synchronous UI reads (`getEditorText()`), and the
session's live objects. When the connection's `initialize` declared
`capabilities.localHandles`, which only the in-process transport accepts,
the connection gets local handles (amended 2026-10-23, v1-completion-plan.md
D11):

- the thread's own `AgentSessionEvent` objects, as `AgentSession.subscribe`
  delivers them;
- read-only views of the thread's `SessionManager`, its session statistics
  and context usage, and the model, resource and extension reads the TUI
  draws from;
- its own `ExtensionUIContext`, bound as the UI of every thread it holds,
  so factories, dialogs and synchronous members work as today.

Every action still goes through protocol methods. On stdio, extension UI
behaves as section 8 says and as RPC mode's does (`rpc-mode.ts:160-240`).
These handles are the only difference between the two transports.

### 7.4 Divergence

After Phase D, `interactive-mode.ts` drives a `RemoteSession` over an
`AppServerClient` instead of a session. Because the facade hands it the
session's own events and reads, a resync of interactive mode stays mechanical except
for the hunks each Phase D slice lists in its PR; those are translated by
hand. Accepted 2026-10-10, narrowed 2026-10-23.

---

## 8. Extension UI over the protocol

### 8.1 Today's API

| `ExtensionUIContext` | Protocol | Desktop | Terminal |
| --- | --- | --- | --- |
| `select`, `confirm`, `input`, `editor` | request `ui/dialog` | in-window dialog | as today |
| `notify` | notification `ui/notify` | toast | as today |
| `setStatus`, `setTitle`, `setWorkingMessage`, `setWorkingVisible` | notification `ui/state`, carrying the whole state | status chips in the thread header, the window title, the text and visibility of the row shown while the model works | as today |
| `setHiddenThinkingLabel` | none | none: desktop reasoning rows have no hidden state | as today |
| `setWidget(key, string[])` | notification `ui/widget` with lines | panel above the composer | as today |
| `setWidget(key, view)` (new) | notification `ui/widget` with a view | the same panel, rendering the `View` | `ViewComponent` |
| widget factories, `custom`, `setHeader`, `setFooter`, `onTerminalInput`, `setWorkingIndicator` | an in-process local handle: the TUI's own `ExtensionUIContext` (section 7.3, Phase D); no wire message | one stderr line per method per thread load: "draws only in the terminal" | as today |

All `ui/*` messages carry `threadId`, and statuses and widgets are keyed by
their key alone, as in the terminal and RPC mode: no message names the
extension, and the extension runner keeps its one shared UI context.
Rejected: a per-extension UI context in the runner. It changes core extension
code, and neither existing client needs it. Two extensions using one key
overwrite each other, as they already do in the terminal; the docs say to
prefix keys.

A client learns a thread's UI from the result that opens it: `thread/start`,
`thread/resume` and `thread/fork` return `ui: UiSnapshot` (statuses, title,
working message, working visibility, widgets), read in the synchronous step
that writes the response, as resume's `queue` is (section 4.5). `ui/state`
and `ui/widget` carry the changes after it, and a reload clears the state.
Rejected: replaying the state as notifications when a connection subscribes.
They would leave before the response that subscribes it, and the desktop's
main process routes a thread's notifications only to windows whose holding
response has passed, so a second window, or a new thread's window, would
never see them.

The server strips ANSI escapes from status text, title, working message and
widget lines, and cuts the first three to 200 code points. A thread holds at
most 50 statuses and 16 widgets, keys are 1 to 128 characters, and each
widget's lines or view is at most 16 KiB; a resume page counts `ui` within its
1 MiB budget (section 5.9). A refused status or widget gives one warning per
key per load, as a `warning` notification, or as a load warning in the
opening result when it happened while the thread loaded.

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

No arbitrary HTML, no scripts, no URLs that load: a view is data. The schema
lives in `packages/app-server-protocol/src/view.ts` with `checkView`, the one
check every path uses. It copies the value through JSON and checks the copy:
a size budget (64 KiB in an item, 16 KiB in a widget), at most 8 levels of
stacks and lists, the schema (unknown members rejected), unique `button` and
`field` ids, table rows as wide as the columns, a field value that fits its
kind and options. The server checks every view an extension hands it, and
stores and sends only the checked copy.

A `button` press or `field` change in a widget is the client request
`ui/event {threadId, widgetKey, id, value?}` → `{}`. Every handler the
thread's extensions registered with `ctx.ui.onViewEvent(handler)` receives
it and checks `widgetKey`. `onViewEvent` is optional on `ExtensionUIContext`
and present only where widgets are interactive (the desktop app), so RPC
mode's context does not change. A press on a widget or control that is gone
answers `{}` and delivers nothing; a value that does not fit answers
`invalidParams`. Rejected: a client notification. The desktop's main process
drops notifications from windows and the server dispatches none but
`initialized`, so both would need new paths, and a failure would be silent.

`packages/cli/src/modes/interactive/components/view-component.ts` renders a
`View` with existing TUI components, so one extension draws in both clients.

A tool result or an extension message may set `details.view`; the item
carries it as `view`, on the live and the read-back path, and the desktop
transcript renders it in place of raw output or markdown, as terminal tool
renderers do today. An invalid view is left out. Controls are live only in
widgets: views in the transcript and every view in the terminal draw their
buttons and fields without sending events, since a result read back from
yesterday has no running code waiting for the press.

### 8.3 Docs the agent reads

The binary already ships `packages/cli/docs`, and the system prompt names
which file answers which topic (`system-prompt.ts:167`). Added docs:

- `docs/desktop.md` — index: what the desktop app is, and links to the rest.
- `docs/app-server.md` — protocol reference, linking
  `docs/app-server.schema.json` (generated).
- `docs/declarative-views.md` — the `View` vocabulary and `onViewEvent`.
- `docs/mcp.md` "MCP Apps" — third-party UI in the desktop (desktop-shell.md
  section 12; the GUI extension SDK this line first reserved
  `docs/desktop-extensions.md` for is dropped, 2026-10-23).
- `examples/extensions/desktop-view.ts` — a widget and a tool result using a
  view.

Line 167 gained one entry, `desktop app and its extensions (docs/desktop.md)`
(delivered in Phase C).
Required tests pin its token cost.

---

## 9. Requirements on the desktop specification

The Electron shell and UI are specified in
[desktop-shell.md](./desktop-shell.md), which answers each requirement below
(its sections 5.1, 4, 5.3, 2 and 12, 11, 10 and 9.8 in order). That
specification must:

- Bundle the platform `knightcode` binary outside `app.asar` in the app's
  resources directory, and spawn `knightcode app-server` from there. Never a
  `knightcode` found on PATH. Write the binary's version to a file beside it
  at build time so launch does not spawn the binary to ask.
- Keep the renderer without Node access. The main process owns the child and
  relays protocol messages to the renderer over a `MessagePort`.
- Restart the app server with backoff when it exits, then `thread/resume`
  every thread on screen. A turn that was running reads back `interrupted`:
  its marker has no end entry (section 4.2).
- Build the integrated terminal, the diff review pane and the web view
  natively, as Codex does, and take third-party UI from MCP Apps, never as
  HTML from agent extensions (amended 2026-10-23: the GUI extension SDK, its
  `desktop` package resource type and its trust gate are dropped;
  v1-completion-plan.md D1-D2).
- Theme through CSS tokens; no colours in components.
- Bind keys through a configurable keybinding table; no hardcoded key checks.
- Leave agent control of the web view to a later specification, but host the
  view where `webContents.debugger` can be attached later: the preview
  `<webview>`'s guest webContents, which main reaches by id.

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
- `packages/cli/src/core/extensions/loader.ts`, `resource-loader.ts`,
  `agent-session-services.ts`, `agent-session.ts`: leased `(cwd, path)`
  factory cache, at most 256 inactive entries, and cleanup on failed
  construction, reload and disposal.
- `packages/cli/src/core/session-lock.ts` (new) and `session-manager.ts`: the
  lock contract of section 5.5 (`close()`, `SessionClosedError`,
  `SessionLockLostError`, read-only `loadEntriesFromFile`, release on
  constructor failure), `findSessionFileInDir` for header-id lookup;
  `agent-session.ts`: `dispose()` closes the manager and releases its
  virtual-model routes; the terminal's fork offer on a held lock.
- `packages/cli/src/core/model-runtime.ts`, `agent-session-services.ts`,
  `agent-session.ts`: owned virtual-model routes (section 5.2).
- `packages/cli/src/extensions/turn-marker.ts` (new), registered first in
  `extensions/index.ts`: the hidden `turn-marker` built-in (section 4.2).
- `packages/cli/src/core/output-guard.ts`: `writeRawStdoutReporting`, a
  stdout write on the shared queue whose failure rejects instead of exiting.
  `writeRawStdout` exits with status 1 on any write error, EPIPE included;
  for the app server that would be a second exit path that skips
  `closeAll`, so a dead client would leave extensions without
  `session_shutdown`. The transport aborts on a failed write and shutdown
  runs as for EOF.
- `packages/cli/src/core/extensions/types.ts`: `"desktop"` in `ExtensionMode`;
  built-in extensions that branch on `ctx.mode` (`plan-mode`, `mcp`, `ui`,
  `llama`, `undo`, `usage`) get a `"desktop"` branch where `"rpc"` behaviour
  would be wrong.
- `packages/cli/src/main.ts` / `cli/args.ts`: `app-server` subcommand.
- `packages/cli/docs/app-server.md`, `app-server.schema.json`,
  `extensions.md` (State paragraph and cache lifetime), `cli.md` (subcommand),
  `sessions.md` (ownership, aliases and fork offer), `session-format.md`
  (turn markers and missing end entries), `sdk.md` (disposal, failed switches,
  lock errors and reopening). Export the ownership errors from the public
  SDK so callers can identify them without parsing message text.
- Changesets: `Added` (the app server), `Added` (the session lock and fork
  offer).

### Phase A2 — the Codex study additions

The changes of section 4.6, before any client ships, all in the app server and
its protocol package (section 4.7). Files:

- `packages/app-server-protocol/src/protocol.ts`: every type and method of
  section 4.6, no version number; regenerated
  `packages/cli/docs/app-server.schema.json`.
- `packages/cli/src/app-server/server.ts`: `optOutNotifications` in fan-out,
  `platform`, `server/diagnostics`.
- `item-mapper.ts`, `transcript.ts`: timestamps, `TurnError`, `fileChanges`
  diffs, `clientMessageId`, `thread/tokenUsage/updated`; live and read-back
  share each computation.
- `extensions/turn-marker.ts`: `classifyAssistantError`; the end entry stores
  `error.kind`.
- `threads.ts`, `loaded-thread.ts`: object `ThreadStatus` with `waitingOn` and
  `systemError`; `expectedTurnId` and `turnId` checks; `thread/delete`; the
  server-side queue; image `{path}` input (absolute path, regular file, at
  most 20 MiB, type from the file's magic bytes, read once at the request and
  stored base64 as today).
- `config.ts` (new): `config/read` and `config/write` over `FileSettingsStorage`
  and `SettingsManager.fromStorage`, unchanged.
- `approvals.ts`, `command-prefix.ts`: `decisions`, `reason`, `prefix` and its
  matching rules, decline `message` (section 5.4).
- `models.ts`: `thinkingLevels` per model; `project/trust/*`.
- `file-search.ts` (new): `file/search`.
- `listing-pages.ts`, `listing-index.ts`, `session-files.ts`: the listing index
  (section 5.10).
- Docs: `app-server.md`, `session-format.md` (the end entry's `kind`).
- Changeset: folded into the app server's `Added` entry; nothing has shipped.

### Phase A3 — cancellation out of the harness

Done 2026-10-15 (section 4.7): the harness signal plumbing is reverted and
cancellation lives in `threads.ts` and the start-guard extension.

### Phase B — workspaces, diffs, git

- `packages/cli/src/app-server/workspaces.ts`, `diff.ts`, `git.ts`; methods
  of section 6 in `protocol.ts`, including `carryLocalChanges`, worktree
  settings and `thread/workspace/progress` (section 6.1).
- Docs: `app-server.md`.
- Changeset: `Added`.

Status (2026-10-18): done, on `feat/app-server-worktrees` (Tasks 0-11 of
`phase-b-plan.md`). Modules: `git.ts`, `workspaces.ts`, `diff.ts`,
`git-actions.ts`; tests `test/app-server/{git,worktrees,worktree-setup,
worktree-fork,diff,turn-diff,diff-actions,git-actions,handoff,
worktree-archive}.test.ts`. Departures from the plan are recorded with their
reasons in the commit history; the notable one is that `git worktree remove`
deletes the administration directory even when removing the checkout fails, so
a leftover directory is removed only when empty and otherwise left in place
with a warning.

### Phase C — extension UI over the protocol

Plan: [phase-c-plan.md](./phase-c-plan.md). Delivered as one PR on
`feat/extension-ui-views`. Done already (338589ff8): `ui/dialog`, `ui/notify`
and `ask_user`'s `item/toolCall/requestUserInput`.

- `packages/app-server-protocol/src/view.ts` (new): `View`, its limits,
  `checkView`. `protocol.ts`: `ui/state`, `ui/widget`, the `ui/event`
  request, `UiSnapshot` in the `thread/start`, `thread/resume` and
  `thread/fork` results, `view` on `toolCall` and `extensionMessage` items.
- `packages/cli/src/core/extensions/types.ts`: the `setWidget` overload taking
  a `View`, `ViewEvent`, optional `onViewEvent`; type-only, with exports. The
  runner and RPC mode do not change.
- `packages/cli/src/app-server/`: `dialogs.ts` (each thread's extension UI
  state, its notifications, terminal-only reports, `ui/event` dispatch),
  `loaded-thread.ts`, `threads.ts` (results, `ui/event`, the clear before a
  reload), `history-pages.ts` (`ui` in the page budget), `transcript.ts` and
  `item-mapper.ts` (`details.view` on both paths).
- `packages/cli/src/modes/interactive/components/view-component.ts`; views in
  `interactive-mode.ts` widgets, `tool-execution.ts` and `custom-message.ts`.
- `apps/desktop/src/renderer/`: the `ui` slice in `store.ts`,
  `components/view.tsx`, status chips and the window title in
  `thread-view.tsx`, the working row and extension message views in
  `items.tsx`, tool row views in `activity.tsx`.
- `docs/desktop.md`, `declarative-views.md`, `app-server.md`,
  `extensions.md`, `examples/extensions/desktop-view.ts`,
  `system-prompt.ts:167` entry with a test pinning its length.
- Changeset: `Added`, for `@knightcodeai/cli`; the desktop app takes none.

### Phase D — terminal CLI migration

Plan: [v1-completion-plan.md](./v1-completion-plan.md), Tasks D0-D6; after
the desktop phases S2b, S3 and S4 ship.

- `packages/cli/src/modes/interactive/` (`remote-session.ts` new): slices 1-5
  of section 7.1, one or more PRs per slice. `print-mode.ts` does not change.
- `packages/cli/src/app-server/in-process.ts`: local handles.
- Protocol additions of section 7.2; the local handles of section 7.3.
- Changeset per slice only where behaviour visible to users changes.

---

## 11. Required tests

Protocol (`packages/app-server-protocol/test/`):

- Every method, notification and request schema accepts a valid example and
  rejects a missing required field and an unknown member.
- `ThinkingLevel` in the protocol equals `@knightcode/agent`'s union.
- The generated JSON Schema is up to date (regenerating produces no diff).

Session files and the model runtime (`packages/cli/test/`):

- `SessionManager.open` on a file another holder locks throws
  `SessionLockedError`; after release it succeeds. Two managers in one
  process share the lock until both close. Disposing a session releases its
  file.
- A closed manager is readable and rejects writes with `SessionClosedError`;
  after another holder opens the file, the closed manager's append writes
  nothing. For a closed and for a lost manager, every write and tree-move
  path of section 5.5 throws and leaves the leaf, the entries and the file
  unchanged.
- `forkFrom` takes the destination's lock before the destination file
  exists.
- `loadEntriesFromFile` and `forkFrom` leave a source file without a
  trailing newline byte-for-byte unchanged; opening it as owner repairs it.
- A file whose header id is invalid fails to open and leaves no lock.
- Ownership: after another holder takes the lock, the next check reports it
  lost before any refresh runs, a write is rejected, and releasing leaves
  the other holder's lock in place (also with the other holder a real child
  process). A refresh delayed past the stale threshold keeps the lock; a
  deleted lock directory is taken again; a refresh after a takeover leaves
  the new holder's directory untouched. Two real processes: A holds the
  lock and stalls, B takes it over, A exits (once after releasing, once
  without), and B's lock is still held.
- Virtual-model routes: two owners register one virtual model; each resolves
  through its own route, also through an owner-bound registry's
  `streamSimple`; releasing one owner keeps the other's route and the
  catalog entry; an owner with no route gets "not registered in this
  session".
- Turn markers: two prompts write two marker and end pairs; an automatic
  retry and a follow-up stay inside one pair; an abort ends `interrupted`.

Server (`packages/cli/test/app-server/`, faux provider, in-process transport
unless stated):

- A method before `initialize` answers `notInitialized`.
- Transports: a malformed line answers an `error` and the connection stays
  open; an oversized line is dropped up to its newline, counted in UTF-8
  bytes (a multibyte line under the limit in characters but over it in bytes
  is dropped); `close("drain")` delivers a response sent just before it,
  `close("abort")` does not; output past the pending limit aborts the
  connection. A request whose handler is still awaiting when stdin ends is
  answered after the EOF, and only then does output close.
- `thread/start` then `turn/start` emits, in order: `turn/started`,
  `item/started` `userMessage`, `item/completed` `userMessage`,
  `item/started` `agentMessage`, at least one `item/agentMessage/delta`,
  `item/completed`, `turn/completed` `completed`.
- A tool-calling faux reply produces `toolCall` items, `pending` at the end
  of their message and `completed` at the end of execution, and `edit`'s item
  carries `fileChanges`. Calls in one reply keep block order however they
  finish; an aborted reply's unexecuted call appears live and on read-back,
  `failed` on both. A reply with content `[toolCall, text]` orders the call
  before the text both live (by `index`) and on read-back. A `message_end`
  handler that replaces a tool result changes the live `item/completed`
  output to the saved one.
- Two threads in two cwds run turns concurrently; each subscriber receives
  only its thread's turn and item notifications, and both receive sidebar
  notifications.
- A resume of a fork whose load is still running joins that load (one
  session), and an archive of it waits for the load, then moves the file. A
  load that fails after the services registered a virtual model leaves no
  route. An acquisition whose owner token cannot be written leaves no lock
  and no refresh timer.
- Two connections resuming one thread share one live session. A resume
  that arrives while the thread unloads gets a new session after the old one
  released the file. Shutdown waits for a load parked in an extension, whether
  it came from `thread/start`, `thread/resume`, `thread/fork` or a
  replacement, and leaves no thread and no lock. A connection that closes
  during its load is not subscribed. The idle timer does not unload a busy
  thread. Archiving a loaded thread and an unloaded one, each followed by a
  resume, loads the archived file once. An archive that arrives while a
  resume of the same thread is parked in an extension factory waits for
  it, disposes it, and then moves the file; no session is left on the old
  path. A shutdown that starts while a resume is still finding its file
  waits for that resume.
- A thread whose file a separate process holds (a child process running
  `SessionManager.open`) answers `threadLockedElsewhere`, and `thread/read`
  still succeeds without writing to the file.
- `thread/read` after a completed turn returns the same turn and item ids the
  live notifications carried, including a tool call, thinking, a second
  assistant message, a steer sent during the turn, an automatic retry and a
  follow-up; also with the `turn-marker` built-in disabled, and with another
  extension appending an entry at `agent_start`. An aborted turn reads back
  `interrupted`; a marker without an end entry reads back `interrupted`; a
  session without markers reads back one turn per user message.
- `thread/resume` during a streaming reply returns the running turn with the
  partial text; that text plus the deltas that follow equals the final text.
- Two concurrent `turn/start`s: one starts, the other answers
  `turnInProgress`; `turn/interrupt` yields `turn/completed` `interrupted`.
  A `turn/interrupt` while a start waits in an `input` hook, in the auth
  check, or in an extension command that then calls `ctx.sendUserMessage`
  launches no run.
  `thread/settings/update` during a turn applies without waiting.
- A compaction on an idle thread after unload and resume carries the same id
  live and read back.
- Two threads selecting one extension's virtual model route with their own
  session's context, also after the other thread unloads, and an extension
  command streaming that model directly through `ctx.modelRegistry` routes
  with its own session.
- An extension's `sendMessage` produces an `extensionMessage` item; a model
  change produces `thread/settings/updated`.
- `thread/archive` moves the session file out of the default `thread/list`
  and into `thread/list {archived: true}`; `thread/unarchive` reverses it. A
  renamed session file is still found by its header id.
- A thread with no subscriber unloads after the idle timeout (fake timers),
  releases its lock, and reloads on `turn/start` with its transcript intact.
- Approvals: `ask` requests approval for `bash`, `edit`, and an extension
  tool, not for `read`; `autoEdit` requests for `bash` only; `fullAccess`
  never; `decline` blocks with "The user rejected this tool call";
  `acceptForSession` stops later requests for that tool; the mode survives
  unload and resume; a desktop thread created with the default resumes as
  `ask` on a terminal connection; a malformed stored mode restores as `ask`.
  A disconnect or a `thread/unsubscribe` with another subscriber moves the
  request; with none, the call is blocked with "Tool call cancelled" and
  reads back so. The unsubscribed connection receives
  `serverRequest/cancelled`.
- Approval ordering: a plan-mode block wins over an approval request (no
  request is sent).
- Extension cache: loading extensions for cwd B does not evict cwd A's
  entries.
- Extension mode: an extension sees `ctx.mode` `"desktop"` in a thread a
  stdio client started and `"tui"` in one the in-process terminal client
  started.
- Session replacement: an extension command calling `ctx.newSession()` sends
  `thread/replaced` to every subscriber, unloads the old thread at once
  (`session_shutdown` reason `new`), and the next `turn/start` on the new id
  succeeds; a `session_before_switch` cancel changes nothing;
  `ctx.switchSession()` to a thread already loaded reuses its session.
- A failure while loading (an invalid session file) leaves no thread and no
  lock.
- `ui/dialog` round-trips select, confirm, input and editor; `ui/widget`
  with lines and with a view reaches the subscriber; a factory widget over a
  connection without `localHandles` behaves as RPC mode does.
- Worktrees (temporary git repo): create (detached, no branch), a turn edits
  a tracked file and creates an untracked one, a handoff to local checks out
  a new branch in the main checkout with both uncommitted there and the
  worktree left clean; a dirty main checkout (a tracked edit, or only an
  untracked file) refuses the handoff with `localChanges` and is left
  byte-for-byte unchanged; archive deletes the worktree after a snapshot, and
  restore brings the uncommitted edit back; a worktree thread appears in
  `thread/list` for its project's cwd. Two worktree threads created in the
  same second get different buckets. A thread created with `baseRef: "HEAD"`
  stores the commit SHA, and a commit the user makes afterwards in the main
  checkout does not change its `branch` diff.
- A turn whose `bash` call writes a file emits `turn/diff/updated`; so does
  a second turn editing a file the first already modified. The user's index
  is unchanged afterwards. In a directory outside git, worktree mode,
  `thread/diff/read` and `git/commit` answer `notGitRepo`.
- `git/pr/create` with no `gh` on PATH answers `toolMissing`.
- Stdio tests spawn `bun src/cli.ts app-server` with a faux-provider
  extension: one completes a handshake, starts a thread, picks the faux
  model from `model/list`, and reads `turn/completed`; one closes stdin
  mid-turn and sees the process exit 0; one closes stdin right after a
  request and still receives the response; one never reads stdout and still
  sees the process exit within the deadline; one closes its end of stdout
  (EPIPE on the next write) and still sees `session_shutdown` reach the
  extensions and the process exit 0.
- `thread/fork` at an unknown item creates no file. A branch whose
  destination another holder locks leaves the manager on its old file,
  writable, under its old lock. A transcript left with two names by an
  interrupted archive answers `archiveConflict` with both paths and changes
  nothing.

Implementation-risk regressions (Phase A unless noted):

- Two processes opening a file and a file-symlink alias, plus a directory
  symlink/Windows junction alias, cannot both own it. Nonexistent destinations
  under aliased parents share ownership; hard-linked transcripts are refused.
- After an invalid target, empty-file initialization failure or migration
  failure in `setSessionFile`, append/branch/flush throw `SessionClosedError`
  without writing. Failure to acquire the target retains the old manager.
- `/plan approve fresh` and `withSession` dispatch via new/fork/switch launch
  exactly once on the target; old disposal does not abort them. Interrupt
  during loading, setup or forwarded preflight still cancels them. Test a
  competing target start, active target, cancelled hook and target unload.
- Archive/unarchive with a colliding basename or another process holding the
  destination moves nothing. Gate publication to verify both paths stay
  locked through index update; inject unlink/rollback failures and report
  duplicates rather than deleting someone else's file.
- Final text→thinking, thinking→text, text→tool and dropped-block replacements
  match a client reducer and read-back. An old interrupted call stays failed
  when a new turn starts; only the actual running turn has unfinished calls.
- Append between history pages: no missing/duplicate turns. Branch change,
  malformed and cross-thread cursor: `invalidCursor`. Resume an old page
  during a run and reconstruct its separate snapshot plus later deltas;
  invalid resume establishes no subscription. Listing changes do not shift
  a continuation snapshot; expiry/eviction/filter changes are explicit.
- Fifty image-bearing turns and a single turn/item exceeding 64 MiB read
  successfully over both transports through references/chunks. Split
  multibyte deltas safely; completed notifications do not resend items.
  Unknown/expired payload ids cannot read arbitrary files, and expiry cleans
  spool files without retaining their contents in memory.
- Plain prompt, handled command, handled input, auth/preflight cancellation
  and replacement return distinct dispositions and the effective thread.
  The first disposition wins; matching `turn/started` has the request token,
  including before-response delivery and independent extension-triggered runs.
- `AppServerClient` preserves structured `error.data` byte-for-byte.
- Phase B: a handoff refused for a dirty destination or an operation in
  progress changes nothing; a failed apply keeps the changes in the source
  and in the saved patch (`recoveryRequired`); a deletion whose removal fails
  keeps the worktree and its snapshot.

Section 4.6 additions (Phase A2 unless noted):

- A connection that opted
  out of `item/reasoning/delta` receives none, others still do; an unknown
  opt-out name is ignored.
- A thread with an open approval reads `active` with `waitingOn: ["approval"]`
  in `thread/status/changed` on a connection not subscribed to it, and
  `active` with `waitingOn: []` after the decision. A lost lock leaves the
  thread `systemError` until a resume succeeds.
- Turn and item timestamps, `TurnError.kind`, `fileChanges[].diff` and
  `clientMessageId` match between live notifications and `thread/read` (the
  last is live only and absent on read-back). A faux provider error with a
  rate-limit message reads back `kind: "rateLimit"`, an overflow
  `contextOverflow`.
- A steer with a stale `expectedTurnId` answers `turnMismatch` and queues
  nothing; `turn/interrupt` with an old `turnId` does not stop the running
  turn. A queued follow-up removed by `queueId` is never delivered, also
  when removed while the agent loop already holds it.
- `turn/start` with `{path}` to a PNG stores the same image as the base64
  form; a path to a directory, a non-image or a file over 20 MiB answers
  `invalidParams` and starts nothing.
- `thread/tokenUsage/updated` follows each assistant `message_end`, and its
  totals equal `thread/resume`'s `usage` afterwards.
- `model/list` gives `["off"]` for a model without reasoning.
- Approvals: `bash` never offers `acceptForSession`; `npm test` offers prefix
  `npm test`; `npm test && rm -rf x`, `` echo `id` ``, `a | b`, `a > f` and a
  multi-line command offer no prefix; after `acceptPrefixForSession`,
  `npm test -- --ci` runs unasked and `npm testx`, `npm test; ls` ask.
  `wsl ls` offers no prefix; `pip install x` offers `pip install`, which
  never covers `pip uninstall`, and a stored `pip` matches nothing. A
  decline with a message blocks with that message. An `edit` outside cwd
  carries the outside-workspace `reason`.
- `config/write` with a stale `expectedVersion` answers `configConflict` and
  leaves the file byte-for-byte; `config/read` reports a project-set key's
  origin as `project`; an unparsable settings file produces one `warning`
  with its path.
- `file/search` ranks `src/app-server/threads.ts` first for `thrds` and
  respects `.gitignore`; a superseding request ends the earlier one early.
- `thread/delete` on an unarchived thread answers `threadNotArchived`; on an
  archived one removes the file and broadcasts `thread/deleted`.
- Listing index: after one listing, a second reads zero transcript bytes; an
  appended session is rescanned alone; a corrupt index is rebuilt; a deleted
  file disappears from the list.
- Phase B: a worktree started with `carryLocalChanges` contains the user's
  uncommitted and untracked (not ignored) files as uncommitted changes, and
  the user's checkout is unchanged. `.worktreeinclude` copies a matching
  ignored `.env`; a failing setup script leaves the thread with
  `setupFailed: true` and a `warning`.

Race tests block on explicit gates that prove the operation reached its
blocking point (an extension factory or hook that signals it was entered,
a stubbed await that does the same), and assert order with recorded events.
They never sleep a fixed time and hope; timer behaviour is tested with fake
timers.

Terminal CLI:

- The existing interactive and print tests pass after every slice.
- Each slice adds suite tests for the methods it introduced.

Docs:

- The system-prompt docs section grows by at most 15 tokens.
- `sessions.md`, `session-format.md` and `sdk.md` document canonical locks,
  close/dispose, failed-switch invalidation, public ownership errors, and
  marker/end entries; an SDK example catches `SessionLockedError` and offers
  `forkFrom`, and never reuses a disposed manager.
- The schema/reference agree on start dispositions, payload references,
  lean turn completion, anchored history and listing-snapshot expiry.

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
- Backward compatibility with the engine's HTTP routes, or with protocol 1.
- Sandbox or permission profiles, network approval rules, or an AI reviewer
  of approvals (section 4.6).
- A destructive history revert; server-side projects, sidebar sections or
  thread attachments (section 4.6).
- `acceptForSession` for `bash` or `powershell` (section 5.4).

---

## 13. Validation

From the repo root:

- `bun run check-types`
- `cd packages/app-server-protocol && bun x vitest --run`
- `cd packages/cli && bun x vitest --run test/app-server/`
- `bun x prettier --check "packages/app-server-protocol/**/*.ts" "packages/cli/src/app-server/**/*.ts"`
- `bun run scripts/changelog-sections.ts`
- `rg -n "from \"@knightcode/(ai|agent)\"" packages/app-server-protocol/src`
  → no matches.
- `rg -n "exec\(|execSync\(|shell: true" packages/cli/src/app-server` → no
  matches.
- After Phase D: `rg -n "AgentSession\b|AgentSessionRuntime\b"
  packages/cli/src/modes/interactive` → only
  `modes/interactive/remote-session.ts` (print mode keeps its runtime,
  section 7.1).
- Memory: record baseline, ten loaded threads in one cwd, ten distinct cwds,
  each after representative histories/media/tools; then unsubscribe/unload
  all, force GC in a measurement harness, and record retained heap and working
  set. Repeat 100 open/run/unload project cycles, including failed extension
  loads, virtual-model registration and payload expiry. Record active and
  inactive factory counts, payload files/bytes and shared-runtime route counts.
  Inactive factory entries must stay at or below 256; unloaded sessions,
  routes and expired payload files must not accumulate. Node/Bun module
  retention and allocator working-set retention are reported separately.
  Publish timings, fixture sizes and retained/per-thread figures here before
  Phase A acceptance; there is no invented MB target before measurement.
- Listing: benchmark cold and warm initial `thread/list` plus continuations
  on Windows and POSIX with 1,000 and 10,000 sessions, including 100 MiB
  transcripts. Record bytes read, latency and peak heap. Continuations must
  not rescan transcripts. Phase A accepts the initial full scan explicitly;
  do not claim constant-cost or lightweight listing without a metadata index.
  Phase A2 repeats the benchmark with the listing index (section 5.10),
  through `thread/list` with the checked-in harness
  `packages/cli/test/app-server/bench/thread-list.bench.ts`, and records the
  same columns plus index size; the warm initial listing must
  read zero transcript bytes. The cold one still scans everything once.
- Manual: `bun run start` works end to end after each Phase D slice: prompt,
  tool call, `/model`, `/tree`, `/fork`, `!ls`, an extension dialog, an
  extension `ctx.ui.custom` component.

---

### Phase A measurements — 2026-10-11; final-source validation — 2026-10-12

Runtime: Bun 1.3.3, x64. Windows 11 build 26200 and Ubuntu on WSL2,
Linux 6.6.87.2-microsoft-standard-WSL2. These are source-runtime measurements,
not compiled-binary measurements; macOS has not been measured. The measurement
fixtures contacted no paid provider; independent AI reviews used the configured
live model account. The Linux copy used a separate scratch checkout and frozen-lockfile
installation, leaving this checkout and its node_modules unchanged.

The temporary harness ran `bun <measurement-script.ts>` on both platforms. It
created an in-memory credential store, one shared ModelRuntime, ThreadManager
and in-process protocol client, registered a faux provider, and waited for
initialize/thread/start responses and session.waitForIdle rather than sleeping
for startup. Each loaded thread ran a real faux read-tool turn. Representative
history contained 20 marked turns, 32 valid one-pixel PNG blocks per user message,
4,400 user-text characters and 72,000 tool-output characters per turn. Reading
ten threads produced 200 immutable payloads totalling 16,193,300 serialized bytes.
One cached extension registered a session-owned virtual route. The fixture
asserted that extension loading succeeded; an earlier incomplete scratch-copy
run was discarded rather than counted as a zero-route success.

GC: two `Bun.gc(true)` calls with event-loop yields before each sample. Heap below
is `heapStats().heapSize` from bun:jsc, not Bun's occasionally stale
process.memoryUsage().heapUsed. Working set was read with a spawned argument
array: PowerShell `(Get-Process -Id <pid>).WorkingSet64` on Windows and
`ps -o rss= -p <pid>` on Linux. All values below are raw bytes.

| State | Windows JSC heap | Windows working set | Linux JSC heap | Linux RSS |
| --- | ---: | ---: | ---: | ---: |
| Baseline, no loaded threads | 21,084,681 | 380,502,016 | 20,608,557 | 216,002,560 |
| One empty thread | 26,027,877 | 417,611,776 | 23,401,702 | 212,189,184 |
| Ten same-cwd threads, history/media/tools | 69,376,689 | 569,683,968 | 59,755,955 | 303,845,376 |
| Same-cwd unloaded, payload leases still live | 46,420,966 | 463,011,840 | 43,595,372 | 272,429,056 |
| Same-cwd unloaded, payloads expired | 46,370,817 | 464,547,840 | 43,390,867 | 272,691,200 |
| Ten distinct-cwd threads, history/media/tools | 81,847,000 | 569,237,504 | 77,080,922 | 326,070,272 |
| Distinct-cwd unloaded, payloads expired | 55,874,906 | 566,890,496 | 60,666,024 | 304,623,616 |
| Final shutdown, after listing benchmarks | 62,904,133 | 501,239,808 | 57,842,410 | 459,591,680 |

Baseline-subtracted loaded JSC heap per thread is approximately 4,829,201 bytes
(same cwd) / 6,076,232 bytes (distinct cwd) on Windows, and 3,914,740 / 5,647,237
on Linux. These include cache warm-up, payload preparation and prior phases of
the same process; they are not an isolated session-object size or an MB target.
Working-set retention is distinct from live JS ownership. After unload, live
thread/virtual-route/owner counts were zero on both platforms. Payload leases
were advanced by a controlled clock and expired references were read to exercise
lazy expiry; after awaiting removals, payload/file/byte counts were all zero.
The normal 30-minute timer was not shortened in production.

The retention pass opened, ran and unloaded 100 distinct project directories,
with ten refused model-selection loads exercising cleanup after route registration,
and a large payload per cycle. A second 100-cycle pass revisited warmed directories.
Every sample below had zero loaded threads, active factories, virtual owners/routes,
and expired payload records/files/bytes. Inactive factories reached 112 and stayed
there during the warm pass; the independent 300-key regression retains at most 256.

| Pass / cycles | Inactive factories | Windows JSC heap | Windows working set | Linux JSC heap | Linux RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Distinct / 20 | 32 | 61,358,704 | 498,925,568 | 63,372,946 | 290,729,984 |
| Distinct / 40 | 52 | 64,226,728 | 504,631,296 | 64,269,464 | 300,240,896 |
| Distinct / 60 | 72 | 62,932,976 | 507,625,472 | 65,027,078 | 298,151,936 |
| Distinct / 80 | 92 | 64,603,499 | 514,224,128 | 65,485,135 | 298,885,120 |
| Distinct / 100 | 112 | 61,659,338 | 510,148,608 | 62,951,880 | 299,978,752 |
| Warm / 20 | 112 | 64,655,347 | 663,502,848 | 61,712,809 | 294,338,560 |
| Warm / 40 | 112 | 66,994,231 | 569,679,872 | 62,311,286 | 281,239,552 |
| Warm / 60 | 112 | 67,926,777 | 568,307,712 | 62,630,923 | 284,565,504 |
| Warm / 80 | 112 | 66,239,419 | 520,220,672 | 62,983,088 | 304,783,360 |
| Warm / 100 | 112 | 68,673,749 | 590,778,368 | 63,443,289 | 284,639,232 |

This does not promise module unloading or a flat allocator working set. The
warm-pass heap variation triggered a second, 1,000-cycle investigation on each
platform, rather than treating zero ownership counters alone as proof of release.
That fixture repeatedly resumed one fixed saved transcript in one warm cwd,
restoring its initial contents while it was unloaded. This kept both durable
history and saved-path lookup metadata constant (one remembered path), isolating
runtime retention from intentionally creating more saved threads.

Each cycle added WeakRefs to its LoadedThread, AgentSession, SessionManager,
resource loader, extension runtime and item mapper, plus an unreachable control.
After event-loop yields, explicit `releaseWeakRefs()` and GC, Windows sometimes
retained only the most recent disposed set while its deferred callbacks settled;
it did not retain earlier cycles. The final extra sample cleared all 6,006 target
WeakRefs on both platforms. Control targets never survived collection. Live
thread/route counts stayed zero, inactive factories stayed one, and module-record
counts stayed 1,470 throughout. Object-type deltas from cycle 100 to the final
sample show 6,300 additional WeakRefs and about 6,000 tracking-record objects
created by the harness itself; Function, Array, Map and string counts decreased.

| Fixed-file cycles | Windows JSC heap | Windows working set | Linux JSC heap | Linux RSS |
| --- | ---: | ---: | ---: | ---: |
| 100 | 25,268,288 | 552,984,576 | 32,651,548 | 256,131,072 |
| 200 | 26,307,233 | 513,794,048 | 28,135,047 | 265,687,040 |
| 400 | 29,268,132 | 471,928,832 | 28,770,648 | 258,129,920 |
| 600 | 30,704,703 | 512,053,248 | 28,251,010 | 257,687,552 |
| 800 | 27,760,422 | 556,273,664 | 28,621,011 | 249,389,056 |
| 1,000 | 30,937,659 | 539,803,648 | 28,910,012 | 267,862,016 |
| Final settled sample | 25,348,002 | 478,081,024 | 28,818,456 | 252,456,960 |

The fixed-file experiment shows no accumulation of disposed session graphs in
this workload. The remaining measured heap includes the harness's retained
tracking records, runtime module/JIT state and external string/buffer allocations;
OS working set is reported separately and does not fall back to startup size.
It is not a universal leak proof or a promise that arbitrary extensions release
their own module-level state.

The fixed-file soak was repeated against the final reviewed source on 2026-10-12,
with one extra 250 ms event-loop settling interval before its last GC sample.
All 6,006 target references and 1,001 unreachable controls cleared on both
platforms. Loaded threads, active/importing factories, routes, payload records,
payload bytes and readers were zero; one saved path, one inactive factory and
1,470 module records remained. The representative tables above predate the final
cancellation corrections; this repeat verifies their ownership-release conclusion,
not identical allocator sizes or timings.

| Final-source fixed-file cycles | Windows JSC heap | Windows working set | Linux JSC heap | Linux RSS |
| --- | ---: | ---: | ---: | ---: |
| 100 | 25,324,615 | 463,736,832 | 32,726,545 | 252,628,992 |
| 1,000 | 28,489,897 | 530,255,872 | 29,184,803 | 272,953,344 |
| Final settled sample | 27,420,276 | 488,615,936 | 29,076,596 | 258,203,648 |

Listing fixtures comprised 1,000 or 10,000 JSONL transcripts, including one
100 MiB user-text transcript. Fixture generation appended bounded chunks so the
harness did not retain its own 100 MiB string. `cold` below means a fresh listing
snapshot, not a flushed operating-system disk cache; `warm` is another initial
scan of the same files. ReadStream data/open events counted actual transcript
bytes and opens; JSC heap was sampled every 2 ms (an observed peak, not an exact
allocation maximum). Each response contained 50 summaries. Continuations read
zero bytes and opened zero streams on both platforms.

| OS | Sessions | Scan | Bytes read | Opens | Initial ms | Peak JSC heap bytes | Continuation ms |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Windows | 1,000 | cold | 105,180,355 | 1,000 | 2,273.418 | 365,796,356 | 0.830 |
| Windows | 1,000 | warm | 105,180,355 | 1,000 | 1,610.674 | 358,564,229 | 0.766 |
| Windows | 10,000 | cold | 108,105,353 | 10,000 | 6,761.748 | 386,026,470 | 0.778 |
| Windows | 10,000 | warm | 108,105,353 | 10,000 | 31,587.504 | 195,584,903 | 0.846 |
| Linux/WSL2 | 1,000 | cold | 105,146,345 | 1,000 | 12,921.541 | 215,306,560 | 1.021 |
| Linux/WSL2 | 1,000 | warm | 105,146,345 | 1,000 | 12,664.481 | 216,047,998 | 1.816 |
| Linux/WSL2 | 10,000 | cold | 107,745,353 | 10,000 | 1,440.616 | 172,235,844 | 0.706 |
| Linux/WSL2 | 10,000 | warm | 107,745,353 | 10,000 | 1,643.312 | 178,575,010 | 5.361 |

Timings are variable on this shared laptop and include instrumentation/JIT/GC
costs. The reversed cold/warm and 1,000/10,000 timings are recorded, not smoothed
into an invented target. Initial listing demonstrably reads full transcripts;
only continuation work avoids rescans. This fixture does not establish constant
initial listing cost or a lightweight metadata index.

### Phase A2 listing — 2026-10-14

Checked-in harness: `packages/cli/test/app-server/bench/thread-list.bench.ts`.
Run from the repository root with `bun <harness> 1000` and `10000`. Windows
used Bun 1.3.3 x64; Ubuntu/WSL2 used its already installed Bun 1.4.2 x64 on
Linux 6.6.87.2-microsoft-standard-WSL2. The Linux run read this source checkout
through `/mnt/c` and reused existing dependencies; its generated transcripts
and index lived on native Linux `/tmp`. No dependencies or system runtimes
were installed, and no turns or provider requests ran. The two runtimes and
concurrent shared-laptop activity prevent treating these as isolated OS ratios.

Each fresh process generated the requested base count, one single-message
100 MiB transcript, and twenty fork/parent pairs (41 additional transcripts).
Parent filenames deliberately carry UUIDs different from their header IDs.
The harness uses the production handlers and in-process protocol client;
`thread/list` and `server/diagnostics` are real protocol requests, not direct
index calls. It traverses every cold and warm page and asserts the total count.
Cold means no index, not a flushed operating-system cache. Diagnostics count
transcript scans using file sizes, plus parent-header opens without header
bytes; they exclude index I/O and stats. The peak is sampled JSC heap every
2 ms, including a final sample, not an exact allocation maximum or OS RSS.

The [summary JSONL](../../../../packages/cli/test/app-server/bench/results/protocol-2.jsonl)
holds one line per scan, sixteen in all, derived from the 1,776 printed
responses: Windows 1,000 runs 1/2, Windows 10,000 runs 1/2, Linux 1,000 runs
1/2, then Linux 10,000 runs 1/2, cold followed by warm. Each line carries the
initial response's counters and time, the continuation count with min/p50/max
latency, and the peak JSC heap across the whole scan. The table's heap column
is the initial response's peak only. Values are raw bytes and milliseconds; no
noisy result was discarded or smoothed.

| Platform | Base sessions | Run | Scan | Fixture bytes | Scan bytes | Opens | Initial ms | Peak JSC heap bytes | Index bytes | Continuation ms (min–max) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Windows | 1,000 | 1 | cold | 105,224,869 | 105,224,869 | 1,061 | 2301.7 | 118,016,956 | 362,279 | 0.8–1.5 |
| Windows | 1,000 | 1 | warm | 105,224,869 | 0 | 0 | 50.2 | 23,375,746 | 362,279 | 0.9–1.7 |
| Windows | 1,000 | 2 | cold | 105,224,869 | 105,224,869 | 1,061 | 1755.7 | 130,474,981 | 362,279 | 0.7–1.8 |
| Windows | 1,000 | 2 | warm | 105,224,869 | 0 | 0 | 56.2 | 23,832,703 | 362,279 | 0.9–1.8 |
| Windows | 10,000 | 1 | cold | 108,383,869 | 108,383,869 | 10,061 | 9422.6 | 124,280,689 | 3,494,279 | 0.7–5.2 |
| Windows | 10,000 | 1 | warm | 108,383,869 | 0 | 0 | 220.2 | 31,622,996 | 3,494,279 | 0.8–3.9 |
| Windows | 10,000 | 2 | cold | 108,383,869 | 108,383,869 | 10,061 | 8359.2 | 125,161,236 | 3,494,279 | 0.7–4.1 |
| Windows | 10,000 | 2 | warm | 108,383,869 | 0 | 0 | 244.5 | 31,589,045 | 3,494,279 | 0.7–3.5 |
| Linux/WSL2 | 1,000 | 1 | cold | 105,186,633 | 105,186,633 | 1,061 | 16645.3 | 230,255,666 | 330,008 | 0.6–1.5 |
| Linux/WSL2 | 1,000 | 1 | warm | 105,186,633 | 0 | 0 | 46.2 | 230,909,329 | 330,008 | 0.6–1.0 |
| Linux/WSL2 | 1,000 | 2 | cold | 105,186,633 | 105,186,633 | 1,061 | 12251.2 | 333,446,716 | 330,008 | 0.7–1.3 |
| Linux/WSL2 | 1,000 | 2 | warm | 105,186,633 | 0 | 0 | 47.8 | 333,633,209 | 330,008 | 0.8–1.3 |
| Linux/WSL2 | 10,000 | 1 | cold | 108,021,633 | 108,021,633 | 10,061 | 20444.2 | 341,229,967 | 3,180,625 | 0.6–3.0 |
| Linux/WSL2 | 10,000 | 1 | warm | 108,021,633 | 0 | 0 | 354.6 | 31,154,034 | 3,180,625 | 0.4–2.7 |
| Linux/WSL2 | 10,000 | 2 | cold | 108,021,633 | 108,021,633 | 10,061 | 12026.3 | 342,117,026 | 3,180,558 | 0.5–1.4 |
| Linux/WSL2 | 10,000 | 2 | warm | 108,021,633 | 0 | 0 | 332.7 | 343,919,680 | 3,180,558 | 0.5–2.8 |

Every warm initial response and all 1,760 continuation responses report zero
opens and scan bytes. Cold listings report exactly one scan per transcript
plus twenty parent-header opens, including every misleadingly named parent.
The largest index was 3,494,279 bytes, below its 16 MiB limit despite the
100 MiB first message; titles, not message bodies, are cached. These assertions
are in the harness and all eight runs passed. Warm listing still reads the
index and stats files, so zero transcript bytes is not constant-cost listing.
Cold scanning and retained heap remain runtime- and GC-dependent.

### Phase A acceptance record — 2026-10-12

Stdio lifecycle coverage now includes eight cases: unread stdout, EOF with an
accepted response, a faux turn, EPIPE extension shutdown, EOF mid-turn, unfinished
non-cooperative preflight/load responses, and a complete 65 MiB payload round trip.
Final-source selected CLI validation passed 943 tests on Windows (two skipped;
150 passed files plus one skipped) and 944 on Linux/WSL2 (one skipped; 151 passed
files). It includes all app-server, session-manager, ownership, model-runtime,
extension-cache and CLI suite tests. All six protocol tests, root type checking,
formatting, schema regeneration, changeset checks and diff checks passed. This
is not a full root-suite, compiled-binary or native-macOS validation claim.

Independent fresh-context reviews produced concrete ownership, replacement,
preflight, settlement and compaction findings. Their reported traces were
reproduced with failing tests before corrections. One boundary-verification
attempt hit the configured account's usage limit and produced no verdict; it
was not counted as a passing review. A later same-account review found two more
compaction boundaries, reproduced by four failing cases. The corrected cases
passed, and a fresh read-only review accepted both boundaries and found no
important remaining issue in its inspected scope. The queued-input regression
also verifies cancellation settles its request before a gated callback returns.

Phase A acceptance gates are satisfied and protocol v1 was frozen to the generated
schema; section 4.6 (Phase A2) supersedes it before any client ships. Raw measurements, review reports and verification logs remain in the local
implementation ledger's evidence directory. Owned scratch installations/downloads
and temporary measurement scripts are removed after validation. This does not
claim completion of worktrees, git/diffs or desktop UI in later phases.

### Phase B validation — 2026-10-18

Windows 11 build 26200, Bun 1.3, Git for Windows 2.47.1. `test/app-server/`:
45 files, 431 tests passed, 5 skipped (POSIX-only symlink, mode and tab-name
cases). WSL2 could not run on the measuring machine (virtualization is off), so
the Linux run is the CI job's; macOS is not measured.

On this repository (2,344 tracked files, 12,339 untracked ones in a 2.1 GB
directory the user keeps beside the code), five runs each: a turn snapshot
took 197-251 ms and an `uncommitted` `thread/diff/read` 643-668 ms. More than
500 untracked files make both tracked-only, so the untracked directory is not
hashed. Forced to include untracked files, the snapshot took 10.5-23.8 s, so
turn snapshots and diff reads also leave out untracked files over 10 MiB, as
Codex's turn snapshots do; deletion and handoff snapshots never do.

Codex parity walk (Task 11 step 4) ran through the in-process client, since the
desktop panes come in S2: worktree start with an environment, the six Changes
scopes, a comment sent with a turn, a commit with a generated message, a fork
into a new worktree, a handoff refused while the main checkout was dirty and
done once clean, archive and restore. Each behaved as the "Codex parity" table
of `phase-b-plan.md` says; the tests named in section 10's Phase B note pin
every step.

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
- Interactive mode constructs no `AgentSession` of its own; print, JSON and
  RPC modes keep theirs (section 7.1).
- The required tests pass, `bun run check-types` is clean, and every
  validation grep matches as stated.
