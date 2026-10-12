# App Server

`knightcode app-server` hosts many conversation threads in one process. The
threads share models and credentials but own separate session files, extension
runtimes, tools, approvals, and turn queues. The desktop app can spawn it; scripts
can use the same protocol.

The transport is newline-delimited JSON over stdin/stdout. Messages use JSON-RPC
2.0 request, response, and notification shapes without a `"jsonrpc"` field.
Protocol version 1 defines the Phase A wire contract. It is separate from the
single-session [RPC mode](rpc.md). Later desktop phases add worktrees and UI;
those features are not implemented by this server yet.

## Starting

```sh
knightcode app-server [-e <extension>]... [--session-dir <dir>]
```

`-e` / `--extension` is repeatable. Paths resolve against the process working
directory and load in each thread as explicitly trusted CLI paths. Project-local
resources still follow [project trust](security.md#understand-project-trust).
Extension dialogs and custom UI are not yet available in desktop mode; extensions
see `mode: "desktop"` and `hasUI: false`.

Session storage uses `--session-dir`, then
`KNIGHTCODE_CODING_AGENT_SESSION_DIR`, then the global `sessionDir` setting.
Without an override, sessions use the per-project layout described in
[Sessions](sessions.md). stdout carries only protocol messages; logs go to stderr.
Closing stdin shuts down the server. `knightcode app-server --help` (or `-h`)
prints usage on stderr and exits without opening a connection.

## Handshake

Send a request with a string or numeric `id`:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"example","version":"1.0"},"protocolVersion":1,"capabilities":{}}}
```

Wait for its result, then send the notification:

```json
{"method":"initialized","params":{}}
```

Only then send other requests. An incompatible version returns `versionMismatch`;
requests before initialization return `notInitialized`. Unknown methods return
`methodNotFound`; invalid parameters return `invalidParams`.

## Threads and turns

Start a thread with its project directory:

```json
{"id":2,"method":"thread/start","params":{"cwd":"/path/to/project","approvalMode":"ask"}}
{"id":3,"method":"model/list","params":{}}
```

Wait for each response. Extension providers appear in `model/list` after a thread
has loaded them. Pick a model using `thread/settings/update`, with `threadId` and
`model: {provider, id}`, before starting a turn if no usable model is selected.

```json
{"id":4,"method":"turn/start","params":{"threadId":"THREAD_ID","text":"Explain this repository","requestId":"client-start-1"}}
```

A start returns `{status, threadId, requestId}`. `status` is `started`, `handled`
(an extension consumed the input), or `cancelled` (cancelled before acceptance).
It does not wait for the turn to finish. The optional client token `requestId`
is echoed in the response and `turn/started`; it is distinct from the JSON request
`id`. Session-replacing commands preserve it and return the effective target
thread ID. The first acceptance wins even if cancellation follows later.

A plain text turn sends these notifications in order:

1. `turn/started`
2. `item/started` and `item/completed` for the user message
3. `item/started` for the agent message
4. Zero or more `item/agentMessage/delta` notifications
5. `item/completed` for the agent message
6. `turn/completed`

A turn is one agent run between durable start and end entries. Automatic retries,
recovery, steering, and queued follow-ups may span several low-level agent runs
inside it. Turn IDs come from persisted marker entries; item IDs use durable
ordinals except tool calls, which retain their call IDs. Final messages decide
item contents and statuses. Items carry `index`, their top-level position in the
turn: order by its latest value, because a streaming item's index can change at
message end. `item/removed` withdraws an item dropped by a message-end handler.
Nested tool calls carry `parentItemId` and no top-level index. A saved turn with
no end entry reads as `interrupted`. See [Session Format](session-format.md).

`turn/completed` contains a summary without items, avoiding a second large
transcript transfer. `turn/steer`, `turn/followUp`, and `turn/interrupt` control
input and cancellation. Settings changes and compaction serialize with starts;
a thread already running refuses another start with `turnInProgress`. Settlement
hooks and their deferred dispatch also retain admission until they finish.
Steering/follow-up input still waiting in interception belongs to that running
turn: interruption, unloading, or settlement cancels it. It cannot silently enter
a later turn; the waiting request returns `invalidParams`.

### Subscriptions and replacement

`thread/start`, `thread/resume`, and `thread/fork` subscribe the requesting
connection. `thread/unsubscribe` withdraws it. Every initialized connection gets
thread/sidebar and account updates. Only subscribers get turn/item notifications,
deltas, retries, and queue updates. Approvals target one subscriber at a time.

`thread/resume` returns history and subscribes in the same synchronous send step.
Its separate `runningTurn` is a current snapshot, even when an old history cursor
is supplied. Install it before applying buffered deltas. `thread/replaced` moves
subscriptions to the new thread; captured old extension contexts become stale.

### History, listings, and large values

`thread/read` reads saved history without loading or locking the thread and never
writes the source. `thread/resume` loads and owns it. History pages contain at most
50 turns, newest page first; turns within a page are chronological. `nextCursor`
anchors later pages to the original branch prefix, so appends cannot shift the
page. Diverged, foreign, or malformed cursors return `invalidCursor`.

Initial `thread/list` scans full transcripts for names and first messages. It is
not a metadata index. Continuations use an immutable summary snapshot without
rescanning. Up to 32 snapshots are retained with a five-minute sliding expiry;
expired, evicted, or filter-mismatched cursors return `invalidCursor`.

Large turns/items and tool input/output use immutable payload references rather
than oversized protocol lines. Call `payload/read` with the reference ID and a
byte `offset`; concatenate base64-decoded chunks until `eof`. `nextOffset`, when
present, is the next byte offset, not a character count. References expire after
30 minutes without access; reread the thread to obtain new references. IDs grant
access only to server-owned spool files, not arbitrary filesystem paths.

## Approvals

Desktop threads default to `ask`; terminal-mode in-process threads default to
`fullAccess`. Effective mode is persisted on the branch; invalid stored state
restores as `ask`.

| Tool | `ask` | `autoEdit` | `fullAccess` |
|---|---|---|---|
| `read`, `grep`, `find`, `ls`, `ask_user`, `submit_plan` | Allow | Allow | Allow |
| `edit`, `write` | Ask | Allow | Allow |
| Shell, other extension, and MCP tools | Ask | Ask | Allow |

Built-in plan and classifier restrictions run before this gate. Approvals are
not a filesystem or operating-system sandbox.

The server sends `item/toolCall/requestApproval` with thread/turn/item IDs, the
tool name, and input or an input reference. Reply to its `id` with a result such
as `{"decision":"accept"}`. Decisions are `accept`, `acceptForSession`, `decline`,
and `cancel`. `acceptForSession` remembers the tool name in the loaded session;
it is not persisted across unloads. Decline and cancel block execution.

The most recent initiating subscriber is asked first. Disconnect or unsubscribe
cancels that attempt and migrates it to another subscriber; no subscribers means
cancel. `serverRequest/cancelled` withdraws an outstanding request.

## Ownership, unloading, and shutdown

Only one process may own a persisted session file. Symlink/junction aliases share
ownership; hard-linked transcripts are refused. `threadLockedElsewhere` means
another process owns it. [Terminal resume](sessions.md#session-ownership) offers
to fork instead. Read-only discovery and history require no ownership.

If ownership is lost to another process, the thread closes with an `error`
notification rather than continuing writes. Archive/unarchive owns both paths,
refuses destination collisions, and never overwrites another transcript. An
`archiveConflict` can include structured recovery data naming surviving files.

A thread unloads after ten minutes without a subscriber and with no running work.
Unloading releases its session lock, owned virtual routes, and extension-cache
leases. The factory cache retains at most 256 inactive factories plus actively
leased entries. Runtime module unloading is not promised; see
[extension state and cache behavior](extensions.md).

On stdin EOF or SIGINT/SIGTERM, new input stops immediately, pending login flows
cancel, and every thread unloads. Accepted requests still receive answers; work
that cannot finish returns `shuttingDown`. Output drains after accepted requests
settle. At nine seconds, unfinished accepted dispatches receive `shuttingDown`;
late results cannot publish a second response. The final second is reserved for
output drain before the ten-second hard exit, including a client that has stopped
reading stdout. Trusted JavaScript already executing remains cooperative; the
server cannot roll back its private effects or preempt a synchronous callback.

## Limits and client reference

Limits count UTF-8 bytes:

- 64 MiB per stdin line; an oversized line is dropped with an error notification.
- 64 MiB of pending unread output before the connection aborts.
- 1 MiB per history/list response, including envelope reserve.
- 64 KiB per inline turn/item; larger values use references.
- 48 KiB per payload chunk before base64 encoding.

The in-repository `AppServerClient` supports typed `request`, `onNotification`,
`onRequest`, `readPayload`, `resolveTurn`, and `resolveItem` calls. Its
`AppServerError` preserves `code`, `message`, and `data` exactly; inspect `data`
for archive recovery information instead of parsing message strings.
`createInProcessClient` connects the same server/client over an in-memory
transport. A host owns the shared context and `ThreadManager`: stop input, dispose
the context to cancel logins, and await `threads.closeAll()` on shutdown.

Every message is defined in [app-server.schema.json](app-server.schema.json).
Regenerate it from the workspace:

```sh
cd packages/app-server-protocol
bun run generate:schema
```
