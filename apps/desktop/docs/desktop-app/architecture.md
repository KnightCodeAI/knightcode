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

`turnMismatch` answers a steer, follow-up or interrupt whose `expectedTurnId`
or `turnId` names a turn that is not the running one (section 4.4).
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
		| { mode: "local" }
		| { mode: "worktree"; path: string; branch: string; baseRef: string; // baseRef: a commit SHA (6.1)
		    carriedLocalChanges?: boolean; setupFailed?: boolean };
	approvalMode: ApprovalMode;
	model?: ModelRef;
	thinkingLevel: ThinkingLevel;
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
| `thread/list` | `{cwd?, cursor?, archived?}` → `{threads, nextCursor?}`; each a `ThreadSummary` (`Thread` without workspace, approval mode, model and thinking level). Phase A explicitly scans full transcripts on an initial list to obtain names and first messages; it is not a lightweight metadata index. Continuations page a cached, immutable summary snapshot. With an explicit shared session directory, `cwd` filters by each header |
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
| `command/list` | `{threadId}` → `{commands}` (extension commands, prompt templates, skills, as `commandsOf` builds them) |
| `config/read` | `{cwd?}` → `{settings, origins, versions, errors}`; settings, origins and each version come from one read of each file as it is now (never from state loaded earlier), so a version always matches the settings returned. `origins` maps each set dotted key to `"global"` or `"project"` (absent: default); `versions` is `{global, project?}`, a content hash of each file; `errors` are settings files that failed to parse, as `Warning`s with path and, when the runtime reports it, line and column |
| `config/write` | `{scope: "global" \| "project", cwd?, key, value, expectedVersion?}` → `{version}`; `key` is a dotted path, `value` `null` deletes it. A stale `expectedVersion` answers `configConflict` and writes nothing. The compare and the write happen under the settings file's lock, also when the file does not exist yet, on a write queue shared by every settings manager in the process for that file (so a write queued earlier by a thread's manager lands first), and the call answers only once the server's settings reflect the file. Global writes go through the server's own settings manager. The file keeps its other keys |
| `project/trust/read` | `{cwd}` → `{trusted: boolean \| null, needsTrust: boolean}`; `null` when the user has not decided |
| `project/trust/set` | `{cwd, trusted}` → `{}`; records the decision in `ProjectTrustStore`, as the terminal's prompt does (`main.ts:854-891`); loaded threads in that project see it on their next load |
| `file/search` | `{cwd, query, limit?, searchId?}` → `{files: {path, score, indices}[], truncated}`; fuzzy match over the files the `find` tool lists for `cwd` (gitignore respected), at most `limit` (default 50). A newer request with the same `searchId` makes the older one answer at once with no files, even while the listing is still running, and a listing nobody waits for any more is stopped. At most 2 listings run at once; listings are cached per cwd for 10 s, at most 8 cwds, and read at most 32 MiB of output. `truncated` is true when the 32 MiB output cap or 200,000-path cap was reached (cached) or `fd` failed after printing some files (served, not cached); `fd` failing with no output answers `internal` with its error output, never cached. The listing process is killed after 15 s and on shutdown; `fd` missing answers `toolMissing` |
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
least recently used; eviction also makes their cursors invalid. Initial
listing retains today's full-transcript scan cost; section 13 measures it.

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
| Worktree `carryLocalChanges`, include list, setup command, branch prefix (6.1) | A new worktree that lacks the user's uncommitted work or `.env` is unusable for the task; most projects need an install step |

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
the session-file lock (section 5.3), a per-session extension runtime over the
shared model runtime, and an abort signal on prompts. Everything else lives
in `packages/cli/src/app-server/`:

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

**Owed: move cancellation out of the harness (Phase A3).** Phase A threaded an
`AbortSignal` through `AgentSession.prompt()` preflight, `setModel`,
`setThinkingLevel`, extension commands and session replacement, auto-compaction,
`ExtensionRunner.emit*`, and `ModelRuntime.prepareRequest` (about 400 lines in
`agent-session.ts`, `extensions/runner.ts`, `extensions/types.ts`,
`model-runtime.ts`, `sdk.ts`), so that `turn/interrupt` stops a `turn/start`
before its run exists. The server can do this without the harness: let
preflight finish, then call `session.abort()` as soon as the run starts if the
start was cancelled meanwhile. The visible difference is a brief turn that
completes `interrupted`, and input hooks that already ran. Phase A3 makes that
change, reverts the harness part, and adapts `review-preflight.test.ts`,
`replacement*.test.ts` and `prompt-signal.test.ts`. Phase A's concurrency fixes
in `agent-session.ts` (overlapping-prompt guard, `isSettling` admission,
`raceAbort` listener cleanup, compaction-abort results) are offered to pi
upstream at the same time.

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
- A switch to a new file keeps one order: canonical path, new lock, then
  memory and the lock together, then the rewrite, and only then the old
  lock's release. A refused lock changes nothing; a failure after memory
  moved restores the old file under the old lock. A write also checks that
  the held lock is for the current path, not merely that some lock is held.
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
`before_agent_start` hooks, or an extension command, all while the session
still reads idle, so `session.abort()` alone would not stop a start that has
not launched yet. Each `turn/start` gets an abort controller as soon as its
thread is loaded, before it queues and before the first await of
preflight; `turn/interrupt` and unload abort every such controller. The
signal reaches every point where a start can launch something:

- the app server's own auth check, re-checked after the await;
- `prompt()`, right before it queues a steer and right before it launches
  the run (a small `PromptOptions.signal` in the core);
- extension commands: `prompt()` checks the signal before running a
  command, and the command's `ctx.sendUserMessage` passes it on to the
  prompt it starts, exactly as it already passes on the acceptance hook
  `preflightResult`. `/plan <task>` dispatches its task this way, so an
  interrupt while the command runs stops the nested prompt too.

A start cancelled anywhere launches nothing: `turn/start` answers
`{status: "cancelled", threadId, requestId}` and no `turn/started` follows.
A command/input hook that handles it without a run answers `handled`, not
`cancelled`. The core's `PromptDisposition` does not change: RPC mode
returns it and section 12 excludes RPC changes. A signal-stopped prompt
reports `handled` to `preflightResult`, and the app server answers
`cancelled` because its own start signal is aborted. The initiating start
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

`thread/start` takes `workspace`:

- `{mode: "local"}`: the thread runs in `cwd`.
- `{mode: "worktree", baseRef?}`: first resolve the base to a commit,
  `git rev-parse --verify <baseRef ?? HEAD>^{commit}`, then `git worktree
  add -b kc/<threadId> <path> <baseSha>` into
  `<agentDir>/worktrees/<project-hash>/<threadId>`. The thread's cwd is the
  worktree; `Thread.workspace` records path, branch and `baseRef`, which is
  always that commit SHA, never `HEAD` or a branch name. A stored `HEAD` or
  branch moves as the user keeps working, so every later diff against it
  would show a different change set; the SHA is fixed.
- The branch name uses the whole thread id. Session ids are UUIDv7, whose
  leading characters are a millisecond timestamp, so a short prefix is not
  random: two threads created within the same few minutes share their first
  8 characters (a probe produced the same branch name twice). Naming a
  thread does not rename its branch; one name for the thread's whole life is
  what `thread/archive` cleanup and the handoff look up.

The default session directory is derived from cwd
(`session-manager.ts:580`), so a worktree thread's file would land in a
directory of its own and `thread/list {cwd: project}` would not find it. A
worktree thread's session file goes in the project's session directory
instead (`SessionManager.create(worktreePath, projectSessionDir)`), and
`Thread.projectCwd` names the project.

A cwd outside a git repository supports only `{mode: "local"}`; worktree mode
answers `notGitRepo`.

#### Starting from the user's uncommitted work

`{mode: "worktree", carryLocalChanges: true}` starts the worktree from the
main checkout as it is on disk, not as last committed. A user who asks for a
fix to the file they are editing expects the agent to see that edit.

The obvious way, applying the main checkout's diff inside the new worktree
(Codex copies the diff and untracked files across), makes those edits
uncommitted changes of the worktree. Every later diff and the handoff would
then count them as the thread's work, and handing off would apply the user's
own edits to their checkout a second time, which conflicts.

So the server snapshots instead, with the temporary-index technique of
section 6.2, which never touches the user's index or files:

1. `GIT_INDEX_FILE=<temp copy>`, `git add -A`, `git write-tree`: a tree of
   the working directory, tracked and untracked, not ignored.
2. `git commit-tree <tree> -p <HEAD> -m "Local changes at thread start"`: a
   commit no branch points to.
3. That commit is `baseSha`, and the worktree is added at it as above.

The thread's change set is then exactly what it did after the snapshot.
Handoff (below) is unchanged: `apply` brings over only the thread's work, and
`merge` brings the snapshot commit too, which a dirty main checkout already
contains, so `merge` with `carryLocalChanges` answers `gitConflict` with
`data.reason: "localChanges"` unless the main checkout's working tree still
equals the snapshot tree. The thread records `carriedLocalChanges: true` in
`workspace` so clients can say "Started from your uncommitted changes".

#### Project worktree settings

In the project's settings (`.knightcode/settings.json`, so only applied when
the project is trusted) or the global ones:

```ts
interface WorktreeSettings {
	branchPrefix?: string;     // default "kc/"; the branch is `<branchPrefix><threadId>`
	include?: string[];        // gitignore-style patterns of ignored files to copy in, such as ".env"
	setup?: string;            // a shell command run in the new worktree before the thread is returned
}
```

- `include` copies matching ignored files from the main checkout after
  `git worktree add`. Without it a worktree has no `.env`, no local config,
  and the agent's first test run fails for a reason the user cannot see.
- `setup` runs through the platform shell (`bash -c` or `powershell
  -NoProfile -Command`, argument array) in the worktree, with a 10-minute
  timeout. Its output streams as `thread/workspace/progress {threadId, phase:
  "setup", output}` to the connection that started the thread. A failure
  keeps the worktree and the thread, sets `workspace.setupFailed: true`, and
  returns the thread with the last 4 KiB of output in a `warning`; the user
  can still work in it or archive it.
- An untrusted project's settings are not loaded (section 5.2), so its
  `include` and `setup` do not apply. `project/trust/read` reports
  `needsTrust`, and a client asks for trust before offering a worktree.

`thread/worktree/handoff {threadId, strategy: "merge" | "apply"}` hands over
the thread's whole change set: commits on `kc/<threadId>`, uncommitted edits
and untracked files (not ignored ones). `git diff <baseRef>...` alone would
miss the last two. Both strategies start the same way:

1. Refuse while a turn runs (`turnInProgress`).
2. Commit everything pending in the worktree onto `kc/<threadId>`:
   `git add -A`, then `git commit` with the message from section 6.3. The
   change set is now exactly `<mergeBase>..kc/<threadId>`, where
   `<mergeBase>` is `git merge-base HEAD kc/<threadId>` in the main checkout.

Serialize mutating app-server Git operations per canonical checkout path,
not per thread. Handoff reserves both source and destination checkout queues
in canonical sorted order; shared-ref mutations also serialize by the common
Git directory. Before handoff, refuse a pre-existing merge/rebase/cherry-pick
or unresolved index; record HEAD, branch refs, index bytes, and affected
tracked/untracked file fingerprints. Resolve the source branch to a fixed
commit SHA after committing it. Use the captured SHAs for preflight and
execution, and re-check HEAD/index/file fingerprints immediately before
publication. A changed precondition answers `gitConflict` with
`data.reason: "concurrentChange"`, without overwriting the new user state.
This queue cannot prevent an editor or an external Git process from writing.

Then:

- `merge`: preflight with `git merge-tree --write-tree --name-only
  <capturedHead> <sourceSha>`. Exit code 1 means tree conflicts: answer
  `gitConflict` with paths and leave the main checkout unchanged. A clean
  preflight permits `git merge --no-ff <sourceSha>` but is not a transaction:
  a rejecting `pre-merge-commit` hook can leave `MERGE_HEAD`, and hooks or
  external writers can change files. Classify local-change refusal as
  `data.reason: "localChanges"`. On later failure, inspect Git state; attempt
  `git merge --abort` only if this operation created that merge and the
  captured/observed state proves it will preserve pre-existing changes and
  intervening edits. Verify the result against the captured state. Otherwise
  stop and report `gitConflict` with `data: {reason: "recoveryRequired",
  operation, paths, recoveryInstructions}`; never force-reset, stash, or
  remove merge metadata to pretend success. `merge-tree --write-tree` needs
  Git 2.38 or later; older Git answers `toolMissing`.
- `apply`: `git diff --binary <mergeBase> <sourceSha>`, then `git apply
  --check`, re-check the captured checkout state, then `git apply`. No
  `--3way`, which could write conflict markers. A normal patch rejection
  leaves the checkout unchanged; an external race or I/O failure requires
  inspection and the same conservative recovery reporting. Successful
  application leaves the change uncommitted on top of the user's edits.

Neither strategy resolves conflicts or discards user changes. The server
cleans up an operation it can safely undo; it does not promise that arbitrary
hooks, I/O failures or concurrent external writers can never leave a merge
in progress. Unsafe cleanup is reported, with instructions, not attempted.
Archive/worktree cleanup follows this same per-checkout mutation queue.

`thread/archive` on a worktree thread removes the worktree only when it has
no uncommitted changes; otherwise it archives and keeps the worktree, and says
so in the result. Worktrees the app server did not create are never touched.

### 6.2 Diffs

| Method | Behaviour |
| --- | --- |
| `thread/diff/read {threadId}` | working tree against base (`HEAD` for local, `baseRef` for worktree): files, hunks, line ranges, binary flag. With more than 500 untracked, not ignored files it returns tracked changes only and `untrackedSkipped: <count>`, so a missing `.gitignore` entry for a build directory cannot stall the call |
| `thread/diff/revert {threadId, path, hunk?}` | reverse-applies one hunk or restores one file |
| `thread/diff/comment {threadId, comments}` | composes one follow-up message quoting each comment's anchored lines, then behaves as `turn/queue/add` |

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

Taken at the run's first `agent_start` and at `agent_settled`; when the two
tree ids differ, `files` is `git diff --name-only <before> <after>`. That
names every file whose content changed during the turn, including a second
edit to a file that was already dirty.

What it does not do is attribute: a snapshot covers the whole working tree,
so a change another local thread in the same checkout made during the
overlap, or one the user made in an editor, is in the list too. So
`turn/diff/updated` means "files that changed while this turn ran", and the
protocol and the desktop UI say so. Exact per-turn attribution needs
isolation: a worktree thread is the only writer in its worktree, so its
`files` are its own (apart from edits the user makes in that worktree). Two
local threads in one checkout cannot be told apart, and Phase B does not
try; `fileChanges` on tool calls remains the exact record of what the
`edit` and `write` tools did.

Outside a git repository there is no `turn/diff/updated`, and `thread/diff/*`
and `git/*` answer `notGitRepo`. Tool calls still carry `fileChanges`.

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
`shell/abort` for `!` commands. Context usage and session stats come from
`thread/tokenUsage/updated` and the `usage` of `thread/resume`,
not from separate reads.

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

The Electron shell and UI are specified in
[desktop-shell.md](./desktop-shell.md), which answers each requirement below
(its sections 5.1, 4, 5.3, 12.4, 12.1, 12.1, 11, 10 and 9.8 in order). That
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
- `agent-session.ts`, `extensions/runner.ts`, `extensions/types.ts`:
  `PromptOptions.signal` and `SendUserMessageOptions.signal`, checked before
  a command runs, a steer queues or a run launches, and passed through a
  command's `ctx.sendUserMessage` (section 5.6).
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

Owed (section 4.7). Independent of the desktop phases; do it before the next
resync from pi if possible, since it removes most of Phase A's conflict surface.

### Phase B — workspaces, diffs, git

- `packages/cli/src/app-server/workspaces.ts`, `diff.ts`, `git.ts`; methods
  of section 6 in `protocol.ts`, including `carryLocalChanges`, worktree
  settings and `thread/workspace/progress` (section 6.1).
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
- Worktrees (temporary git repo): create, turn edits a tracked file and
  creates an untracked one, handoff `apply` leaves both uncommitted in the
  main checkout; handoff `merge` merges the branch including both; a
  conflicting `merge` or `apply` answers `gitConflict` with paths and leaves
  the main checkout byte-for-byte unchanged, with no merge in progress, also
  when the checkout was already dirty; archive refuses to delete a worktree
  with uncommitted changes; a worktree thread appears in `thread/list` for
  its project's cwd. Two worktree threads created in the same second get
  different branches. A thread created with `baseRef: "HEAD"` stores the
  commit SHA, and a commit the user makes afterwards in the main checkout
  does not change its `thread/diff/read`.
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
- Phase B: rejecting merge hook, pre-existing merge/rebase, dirty/untracked
  files, concurrent HEAD/index edits, external writes, failed apply and
  cleanup failure preserve user state or report `recoveryRequired`; never
  assert that clean `merge-tree` preflight alone prevents `MERGE_HEAD`.

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
  uncommitted and untracked (not ignored) files, `thread/diff/read` is empty
  before the first turn, and handoff `apply` brings back only the thread's
  edits. `include` copies a matching ignored `.env`; a failing `setup`
  leaves the thread with `setupFailed: true` and a `warning`.

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
  packages/cli/src/modes/interactive packages/cli/src/modes/print-mode.ts`
  → type imports from the protocol only.
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

The [complete printed JSONL](../../../../packages/cli/test/app-server/bench/results/protocol-2.jsonl)
records all 1,776 responses: Windows 1,000 runs 1/2, Windows 10,000 runs 1/2,
Linux 1,000 runs 1/2, then Linux 10,000 runs 1/2. Each run contains the initial
response and all continuations, cold followed by warm. The table records all
sixteen initial responses and each run's continuation latency range. Values
are raw bytes and milliseconds; no noisy result was discarded or smoothed.

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
