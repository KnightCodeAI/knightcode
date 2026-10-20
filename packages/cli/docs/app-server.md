# App Server

`knightcode app-server` hosts many conversation threads in one process. The
threads share models and credentials but own separate session files, extension
runtimes, tools, approvals, and turn queues. The desktop app can spawn it; scripts
can use the same protocol.

The transport is newline-delimited JSON over stdin/stdout. Messages use JSON-RPC
2.0 request, response, and notification shapes without a `"jsonrpc"` field.
There is no protocol version number: the client and the server ship together,
and a client that needs a newer server checks `serverInfo.version`. It is
separate from the single-session [RPC mode](rpc.md). Worktrees, diffs, git operations and
extension dialogs are later phases; this server does not implement them yet.

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
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"example","version":"1.0"},"capabilities":{"optOutNotifications":["item/reasoning/delta"]}}}
```

The result contains `serverInfo` and `platform: {os, arch, homeDir}`. `os` is `win32`, `darwin`, or `linux`.
`capabilities.optOutNotifications` is an optional array of at most 256 method
names, scoped to this connection. Unknown names are tolerated. It filters only
notifications, never responses or server requests such as approvals.

Wait for its result, then send the notification:

```json
{"method":"initialized","params":{}}
```

Only then send other requests. Requests before initialization return `notInitialized`. Unknown methods return
`methodNotFound`; invalid parameters return `invalidParams`.

## Threads and turns

Start a thread with its project directory:

```json
{"id":2,"method":"thread/start","params":{"cwd":"/path/to/project","approvalMode":"ask"}}
{"id":3,"method":"model/list","params":{}}
```

Wait for each response. `thread/start` and `thread/fork` return
`{thread, warnings}`. A fork is named after its source with ` (fork)` appended. `thread/resume` also returns warnings; render them from the
response, because they can occur before subscription. A warning has
`{message, source, path?, line?, column?}`, where `source` is `settings`,
`extension`, `trust`, or `server`. Malformed settings, refused extension loads,
and undecided project trust do not silently disappear. Later extension errors
send a subscriber-only `warning` with `threadId`.

Threads and list summaries include `createdAt` (header creation time) and
optional `forkedFromId` (the parent's header ID, not a UUID inferred from its
filename). A loaded thread also carries `sessionFile`, the session file's path,
once it has been saved. List summaries use file modification time for
`updatedAt`; loaded threads use the latest entry time, falling back to the
header. Their `status` is one of:

- `{type: "notLoaded"}`
- `{type: "idle"}`
- `{type: "active", waitingOn: []}`; the array can contain `approval` and `dialog`.
- `{type: "systemError", message}`; ownership loss remains visible after unload
  until a successful reload.

`thread/status/changed` broadcasts these objects, including the first opening
and last closing of an approval or dialog.

Extension providers appear in `model/list` after a thread has loaded them.
Each model has `thinkingLevels`, the accepted picker values; non-reasoning
models report `["off"]`. Pick a model using `thread/settings/update`, with
`threadId` and `model: {provider, id}`, before starting a turn if no usable model
is selected.

```json
{"id":4,"method":"turn/start","params":{"threadId":"THREAD_ID","text":"Explain this repository","requestId":"client-start-1","clientMessageId":"optimistic-1","images":[{"path":"/absolute/path/screenshot.png"}]}}
```

A start returns `{status, threadId, requestId}`. `status` is `started`, `handled`
(an extension consumed the input), or `cancelled` (cancelled before acceptance).
It does not wait for the turn to finish. The optional client token `requestId`
is echoed in the response and `turn/started`; it is distinct from the JSON request
`id`. Session-replacing commands preserve it and return the effective target
thread ID. The first acceptance wins even if cancellation follows later.

`turn/start` and `turn/queue/add` accept optional `clientMessageId` (1–128
characters). It is echoed on the first live `userMessage` of the turn the input
starts, after input transformations; it is not persisted. A handled or removed
input creates no matching item.
Their `images` accept inline `{mimeType, data}` base64 images or `{path}` on the
server's shared filesystem. Path images must be absolute, regular PNG, JPEG,
GIF, or WebP files of at most 20 MiB; missing, relative, non-image, directory,
and oversized inputs return `invalidParams`.

A plain text turn sends these notifications in order:

1. `turn/started`
2. `item/started` and `item/completed` for the user message
3. `item/started` for the agent message
4. Zero or more `item/agentMessage/delta` notifications
5. `item/completed` for the agent message
6. `turn/completed`

A turn is one agent run between durable start and end entries. Automatic retries,
recovery, and steering may span several low-level agent runs inside it. Turn IDs come from persisted marker entries; item IDs use durable
ordinals except tool calls, which retain their call IDs. Final messages decide
item contents and statuses. `Turn` requires numeric `startedAt` and optionally
has `completedAt`; items optionally carry both. Times are Unix milliseconds,
unlike thread creation/modification times, which are ISO strings. Durable turn
markers and end entries determine final turn times. Assistant text/reasoning
uses message timestamp and duration, and tool calls finish at the tool-result
timestamp. User, compaction, and extension items may have only completion time.
Nested calls are live-only. An interrupted turn without an end entry has no
completion time.

Started-item times and streaming contents are provisional. `item/completed`
replaces **times, text, fileChanges, and index**; do not just append deltas.
`index` is the item's top-level position in the turn: order by its latest value,
because a streaming item's index can change at message end. `item/removed`
withdraws an item dropped by a message-end handler.
Nested tool calls carry `parentItemId` and no top-level index. A saved turn with
no end entry reads as `interrupted`. See [Session Format](session-format.md).

Completed edit/write calls include `fileChanges: [{path, kind, diff?}]`;
`kind` is `add`, `modify`, or `delete`. A non-empty tool-result patch becomes
`diff`. Extension tools can report validated file changes through result details;
a malformed report is ignored as a whole. Failed calls report no changes.

`turn/completed` contains a summary without items, avoiding a second large
transcript transfer. Failed turns have `error: {message, kind}`, where `kind`
is `auth`, `rateLimit`, `contextOverflow`, `network`, `provider`, or `other`,
classified from the error text. Summaries and references bound `error.message` to 2,000 characters;
full payloads retain it. Interrupted outcomes take precedence over failures.

`turn/steer` hands input to the running turn and requires `expectedTurnId`, the
currently running turn ID. A stale ID returns `turnMismatch`, so a steer never
lands in a later turn. A steer cannot be taken back once accepted.

`turn/queue/add` queues input on the server and returns `{queueId}`. Each queued
input starts a turn of its own once the thread is idle, oldest first; on an idle
thread it starts at once. Until it starts it is removable with
`turn/queue/remove`. A queued input that fails to start (no model, signed out) is
dropped with an `error` notification. `turn/queue/updated` sends
`{threadId, steering: [text], followUp: [{id, text}]}`: steers the agent has not
delivered yet, and the queued inputs.

`turn/interrupt` accepts optional `turnId`; a supplied stale ID returns
`turnMismatch`, while omitting it retains interrupt-current behavior. It drops
queued inputs, as Escape does in the terminal; the client still has their text
from `turn/queue/updated` to restore into its composer.

An interrupt answers at once; it does not wait for extension hooks. A start
interrupted during its input hooks or an extension command returns `cancelled`
and launches nothing, but hooks already running finish. A start interrupted
later, during compaction before the run or `before_agent_start`, returns
`started`, and its turn completes `interrupted` without a model request.

Settings changes and compaction serialize with starts;
a thread already running refuses another start with `turnInProgress`. Settlement
hooks and their deferred dispatch also retain admission until they finish.
Steering input still waiting in interception belongs to that running
turn: interruption, unloading, or settlement cancels it. It cannot silently enter
a later turn; the waiting request returns `invalidParams`.

### Subscriptions and replacement

`thread/start`, `thread/resume`, `thread/fork`, and `turn/start` subscribe the
requesting connection. `thread/unsubscribe` withdraws it. Every initialized
connection gets thread/sidebar and account updates, including
`thread/turn/completed: {turn}` for completed, failed, and interrupted outcomes.
Only subscribers get `turn/completed`, turn/item notifications, deltas, retries,
queue updates, and `thread/tokenUsage/updated`. Approvals target one subscriber
at a time.

Initialize visible sidebar rows from newest-page `thread/read`, without loading
or subscribing to all threads or resolving referenced turn payloads. Keep live
outcomes arriving during a read and apply them after its result. An absent saved
last-seen turn ID establishes a baseline; live completions can still mark unread.
Active/waiting status outranks the previous outcome; `systemError` stays separate.
Desktop OS notifications are for live outcomes, not initial history.

`thread/resume` returns history and subscribes in the same synchronous send step.
Its separate `runningTurn` is a current snapshot, even when an old history cursor
is supplied. Its required `queue` and `usage` are also live send-time snapshots,
not values from handler entry or the history cursor. Buffer queue/usage events
while awaiting the response, install the snapshots (an empty queue clears stale
state), then replay the buffered events. Invalid cursors subscribe nobody.
Install `runningTurn` before applying buffered deltas. `thread/replaced` moves
subscriptions to the new thread; captured old extension contexts become stale.
`thread/unsubscribe` returns `{status: "unsubscribed" | "notSubscribed"}`.

`TokenUsage` contains cumulative `input`, `output`, `cacheRead`, `cacheWrite`,
and `cost`, plus optional `contextTokens` and required `contextWindow`.
`thread/tokenUsage/updated: {threadId, turnId, usage}` arrives after every finalized
assistant reply, including replies before tool results and compacted-history
billing. `contextTokens` can be absent when the current context is unknown.

### History, listings, and large values

`thread/read` reads saved history without loading or locking the thread and never
writes the source. `thread/resume` loads and owns it. History pages contain at most
50 turns, newest page first; turns within a page are chronological. `nextCursor`
anchors later pages to the original branch prefix, so appends cannot shift the
page. Diverged, foreign, or malformed cursors return `invalidCursor`.

Initial `thread/list` uses a per-directory `.thread-index.json` metadata cache.
It stats transcripts and rescans only new or changed files; the first cold scan
still reads their full history. Cached titles are bounded, never full messages,
and fork origins are cached after resolving parent headers. Warm listings open
no unchanged transcripts or parent headers. Missing, corrupt, invalid, or
oversized (over 16 MiB) indexes rebuild safely; cache writes are best effort.
Directories are scanned sequentially, with at most 64 transcripts open.

Continuations use an immutable summary snapshot without rescanning. Up to 32
snapshots are retained with a five-minute sliding expiry; expired, evicted, or
filter-mismatched cursors return `invalidCursor`.

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
tool name, input or an input reference, and required `decisions`. Optional
`reason` explains the gate (for example, an outside-workspace write), and
optional `prefix` is the offered shell command prefix. Render the supplied
choices, not a hardcoded list. Reply to its `id` with a result such as
`{"decision":"accept"}` or
`{"decision":"decline","message":"Use the project-local file instead"}`.
A decline message is optional and bounded to 4,000 characters; it reaches the
agent as the tool's decline reason. `cancel` always blocks execution. An
unoffered decision is treated as decline and never grants permission.

`acceptForSession` remembers a non-shell tool name for this thread's load,
never across unloads. **It is never offered for bash or PowerShell.** Shells
can instead offer `acceptPrefixForSession` with a positively understood prefix.
For example, a `git status` grant covers `git status --short`, not `git reset`.
Only simple, recognized command forms get a prefix; chaining, redirection,
substitution, quoted/escaped command names, script dispatchers, interpreters,
nested wrappers, and unrecognized subcommand forms fail closed. A later command
must independently produce exactly the granted prefix, not merely start with
its text. Grants are shell-specific and confined to this thread's load.

The most recent initiating subscriber is asked first. Disconnect or unsubscribe
cancels that attempt and migrates it to another subscriber; no subscribers means
cancel. `serverRequest/cancelled` withdraws an outstanding request.

## Dialogs

What KnightCode asks the user mid-turn reaches a desktop connection as a server
request, asked the way approvals are; the thread reports `waitingOn: ["dialog"]`
meanwhile.

`item/toolCall/requestUserInput` carries `ask_user`'s questions, all at once,
with the `itemId` of the call asking, so a client can move back and forth
between them before answering. Each question has an `id`, its text and its
options (`label`, `description`); a label ending in `(Recommended)` is the
recommended one. Reply `{"answers": {"<id>": {"label": "..."}}}` with the
chosen option's exact label and an optional `note`, or `{"other": "..."}` for
the user's own answer; leave out a skipped question. `{}` dismisses the
questions and stops the turn.

`ui/dialog` carries the rest, such as the classifier gate's confirmation of a
risky call and plan mode's review. `kind` says which: a select carries
`options`, a confirm its `message`, an input its `placeholder`, an editor its
`prefill`. Reply with `{"value": "..."}` for a select, input or editor,
`{"confirmed": true}` for a confirm, or `{}` to cancel.

Notices such as "Downloaded model" arrive as the notification `ui/notify` with
a `level` of `info`, `warning` or `error`. Widgets, status, header, footer
and custom components draw only in the terminal and do nothing here. Threads a
terminal-mode connection loads have no dialogs yet.

## Workspaces, diffs and git

A thread runs in a workspace: the user's checkout (`{mode: "local"}`), or a git
worktree of its own (`{mode: "worktree"}`), as in the Codex desktop app.

`thread/start {cwd, workspace: {mode: "worktree", baseRef?, carryLocalChanges?,
environment?}}` creates a worktree on a **detached `HEAD`** at `baseRef` (default:
the checkout's `HEAD`) under `<worktrees.root>/<4 hex digits>/<repository name>`
and runs the thread there, in the same subdirectory the `cwd` had. No branch is
created until `git/branch/create` or a handoff makes one. `carryLocalChanges`
brings the checkout's uncommitted changes (untracked files included, ignored
files not) along as uncommitted edits. Creation runs no hook, filter or user
code, so a failed creation leaves nothing behind. A start whose `cwd` is inside
a managed worktree is a new thread in that worktree.

`thread/workspace/progress {threadId, phase, output}` streams the output of an
environment's setup or cleanup script to the connection that asked. Every
`Thread` carries `workspace`; `ThreadSummary.workspaceMode` marks worktree
threads in listings.

Diffs come in Codex's Changes scopes: `lastTurn`, `uncommitted` (the default),
`unstaged`, `staged`, `committed` and `branch`. Each hunk has a content-hash id;
an action naming a hunk that changed since it was read answers `gitConflict`
with `data.reason: "diffChanged"`. Files changed while a turn ran are reported
by `turn/diff/updated {threadId, turnId, files}` after `turn/completed`, each
file as `{path, additions, deletions}`: the net line totals between the working
tree before and after the turn. A read-back turn carries the same list as
`Turn.files`. This
means "changed while the turn ran", not "changed by the turn": an edit another
local thread or an editor made meanwhile is in the list too. A worktree thread
is the only writer in its worktree, so its list is its own.

Review comments are drafts the client keeps. They travel with the next
`turn/start` or `turn/queue/add` as `comments`; the server quotes the commented
lines from the diff the user reviewed, and the user item shows the comments
next to the typed text.

**Reverting an added file deletes it**, an untracked one included. Clients
confirm with the user before a revert that removes files.

`thread/handoff` moves a chat and its uncommitted changes between its worktree
and the main checkout. The destination must be clean: "Stash or commit your
local changes to hand off." Archiving a thread deletes its worktree after a
snapshot, kept as `refs/knightcode/snapshots/<bucket>/<time>`, and
`thread/worktree/restore` rebuilds it. Past `worktrees.keep` worktrees, the
least recently used are pruned the same way. Outside a git repository, diff and
git methods answer `notGitRepo`.

`gitConflict` errors carry `data.reason`: `diffChanged`, `patchFailed`,
`concurrentChange`, `pushRejected`, `localChanges`, `operationInProgress`,
`branchExists`, `recoveryRequired`, `worktreeDeleted`, `worktreeMissing`,
`worktreeInUse` or `submodules`, with `paths`, `output` or
`recoveryInstructions` where they apply.

## Method reference

All methods require the handshake. Common errors are `notInitialized`,
`invalidParams`, and `shuttingDown`; the additional errors below are
method-specific. The generated schema remains the exhaustive field reference.

### `turn/queue/remove`

Params: `{threadId, queueId}`. Result: `{removed}`. `removed: true` means the
input will not start; false means it was unknown, already started, or already
removed. This does not edit saved history.
Errors: `threadNotFound`.

```json
{"id":10,"method":"turn/queue/remove","params":{"threadId":"THREAD_ID","queueId":"QUEUE_ID"}}
```

### `config/read`

Params: optional `{cwd}`. Result: `{settings, defaults, origins, versions, paths, errors}`.
Without cwd, only global settings are read. With cwd, trusted project settings
merge over global settings; untrusted project files are not read. `origins`
maps dotted leaf keys to `global` or `project`. `versions.global` and optional
`versions.project` are SHA-256 hashes of raw file contents, or `"none"` for an
absent or unread untrusted scope. `defaults` is what an unset key means, in the
shape of `settings`; `paths` names the global and, with cwd, the project file. Settings, origins, versions, and parse errors
come from the same scope reads, not cached settings paired with fresh versions.
Parse errors appear as structured `source: "settings"` warnings with an
optional path and available one-based line/column; unaffected scopes still read.
Storage read/lock failures return `internal`.

```json
{"id":11,"method":"config/read","params":{"cwd":"/path/to/project"}}
```

### `config/write`

Params: `{scope, key, value, cwd?, expectedVersion?}`. `scope` is `global` or
`project`; `key` is a dotted key such as `retry.provider.maxRetryDelayMs`.
`value: null` deletes the leaf. Result: `{version}`, after the write and reload.
Project writes require cwd and an explicitly trusted project. Writes and ordinary
settings setters share a per-file queue across manager instances. Under the file
lock, `expectedVersion`, if present, compares against the current raw-content
hash; existing migrations run before the edit, so deleting a canonical key does
not resurrect its legacy alias. Corrupt JSON is refused without overwriting it.

Errors: `configConflict` with `data: {version}` when the file changed; reread and
resolve the conflict rather than blindly retrying. `invalidParams` rejects
untrusted project writes (`data.reason: "untrusted"`), missing project cwd,
malformed keys, and prototype-pollution segments (`__proto__`, `constructor`,
`prototype`). Read/parse/write failures return `internal`.

```json
{"id":12,"method":"config/write","params":{"scope":"global","key":"theme","value":"dark","expectedVersion":"none"}}
```

### `tool/list`

Params: optional `{cwd}`. Result: `{tools: [{name, description, source}],
defaultTools}`. The tools a new thread in `cwd` would register (without cwd, a
project-less one), from an in-memory session like `command/list`'s; hidden tools
are left out, and MCP tools appear only once a thread connects. `defaultTools` is
the global `defaultTools` setting resolved (`+name` and `-name` applied), or the
built-in default `read`, `bash`, `edit`, `write`. Change it with `config/write`.

```json
{"id":26,"method":"tool/list","params":{}}
```

### `tool/settings/read` and `tool/settings/write`

The KnightCode tools `/tools` manages, stored in `tools.json` in the agent
directory. `tool/settings/read {}` returns `{tools: [{name, enabled, settings}],
classifiers: [{provider, id, name}]}`: each tool's state (its default when the
file does not set it) and its own settings, with values of keys ending in `Key`
masked to their last four characters; `classifiers` are the classifier models
with credentials, for the classifier gate's `model`. `tool/settings/write {name,
key, value}` sets one setting; `enabled` takes a boolean, other keys a string,
and `null` deletes the key. An unknown tool or a malformed key is
`invalidParams`.

```json
{"id":27,"method":"tool/settings/write","params":{"name":"websearch","key":"provider","value":"brave"}}
```

### `mcp/list`, `mcp/update`, `mcp/add` and `mcp/remove`

The servers of the global `mcp.json` and, for an explicitly trusted project, its
`.knightcode/mcp.json` ([MCP](mcp.md)). `mcp/list {cwd?}` returns `{servers,
errors, paths}`: each server's `name`, `scope`, defining file (`source`), the
project file that overrides it (`override`), `transport` (`stdio` or `http`),
`target` (command line or URL), `description`, `enabled` and `exposure`.
`mcp/update {cwd?, name, enabled?, exposure?}` saves the change where `/mcp`
would: in the project override when there is one, else in the defining file.
`mcp/add {scope, cwd?, name, config}` validates `config` as an `mcpServers` entry
and adds or replaces it (result `{replaced}`); `auth` is refused in a project
file. `mcp/remove {scope, cwd?, name}` returns `{removed}`. Project writes need
cwd and a trusted project (`invalidParams`, `data.reason: "untrusted"`).
Connections, sign-in and status belong to the MCP extension in each thread
(`/mcp`); loaded threads pick up file changes when they next load.

```json
{"id":28,"method":"mcp/add","params":{"scope":"global","name":"docs","config":{"url":"https://example.com/mcp"}}}
```

### `resource/list` and `resource/set`

Extensions, skills, prompt templates and themes as `knightcode config` lists them.
`resource/list {cwd?}` returns `{resources: [{type, path, name, enabled, scope,
origin, source}]}` for what a thread in `cwd` (or with no project) would find,
installing nothing. Built-in extensions are left out: they are always on, so
`resource/set` refuses them like any unknown path. `resource/set {cwd?, type, path, enabled}` loads or
skips one resource with a `+` or `-` pattern in the settings of the scope that
defines it: a top-level resource in that scope's `extensions`, `skills`,
`prompts` or `themes`, a package's in that package's filter. Project resources
need a trusted project; an unknown path is `invalidParams`.

```json
{"id":29,"method":"resource/set","params":{"type":"skills","path":"/home/u/.knightcode/agent/skills/review/SKILL.md","enabled":false}}
```

### `project/trust/read`

Params: `{cwd}`. Result: `{trusted, needsTrust}`. `trusted` is true, false, or
null (undecided); `needsTrust` means project-local resources require a decision.
This reads the server-owned [trust store](security.md#understand-project-trust),
not a separate desktop-side preference.

```json
{"id":13,"method":"project/trust/read","params":{"cwd":"/path/to/project"}}
```

### `project/trust/set`

Params: `{cwd, trusted}` with a boolean decision. Result: `{}`. Writes the
server-owned trust store; subsequent loads and config reads use it. Already
loaded runtimes are not silently rebuilt. A `cwd` that is not an existing
directory returns `invalidParams`. Filesystem failures return `internal`.

```json
{"id":14,"method":"project/trust/set","params":{"cwd":"/path/to/project","trusted":true}}
```

### `file/search`

Params: `{cwd, query, limit?, searchId?}`. `query` is 1–256 characters, `limit`
is 1–200 (default 50), and `searchId` is at most 128 characters. Result:
`{files: [{path, score, indices}], truncated}` with cwd-relative paths, fuzzy
scores, and matched character indices. The server lists paths with `fd` using
an argument array, never a shell. A newer request using the same `searchId`
(including from another connection) immediately supersedes the older one,
which returns `{files: [], truncated: false}` unless shutdown takes precedence.

Listings have a ten-second TTL, at most eight cached cwds, and at most two active
listings. Output is capped at 200,000 paths or 32 MiB stdout, with
`truncated: true` when the bounded listing is retained; a 15-second timeout
rejects with `internal`. Partial failed output is usable but never cached;
empty failed output rejects. No remaining waiters means abort; shutdown always
returns `shuttingDown`, even if child rejection
arrives after superseding. `toolMissing` means `fd` is unavailable; other empty
listing failures return `internal`.

```json
{"id":15,"method":"file/search","params":{"cwd":"/path/to/project","query":"src/config","limit":20,"searchId":"composer"}}
```

### `command/list`

Params: `{threadId}` or `{cwd}`. Result: `{commands: [{name, description}]}`:
extension commands, prompt templates, and skills as `skill:<name>`, without the
leading `/`. With `cwd`, the server lists what a new thread in that project would
offer, from a session it builds in memory and never binds: no extension starts,
and nothing is written. Built-in commands that only work in the terminal
(`usage`, `llama`, `undo`) are left out.

```json
{"id":17,"method":"command/list","params":{"cwd":"/path/to/project"}}
```

### `thread/delete`

Params: `{threadId}`. Result: `{}`. Permanently removes an archived transcript;
it does not use the interactive resume selector's trash command. Archive first,
then explicitly delete. The thread must have no running/admitted work. Deletion
fences new starts and reloads, rechecks archive/busy state inside that fence,
and locks/verifies the raw file before unlinking. Refused rechecks preserve the
loaded thread and subscriptions. Success broadcasts `thread/deleted: {threadId}`
to every initialized connection.

Errors: `threadNotFound`, `threadNotArchived`, `turnInProgress`,
`threadLockedElsewhere`, and `archiveConflict` for hard-linked transcripts;
filesystem failures return `internal`.

```json
{"id":16,"method":"thread/delete","params":{"threadId":"ARCHIVED_THREAD_ID"}}
```

### `server/diagnostics`

Params: `{}`. Result: `rssBytes`, `heapBytes`, `loadedThreads`, `loadingThreads`,
`payloadFiles`, `payloadBytes`, `inactiveFactories`, `uptimeMs`,
`listingFilesOpened`, and `listingBytesScanned`. The listing counters are
cumulative: transcript scans account for file sizes and parent-header lookups
add opens, but not bytes. They exclude index reads and filesystem stat work.
Diagnostics observe the shared server, not only this connection.

```json
{"id":18,"method":"server/diagnostics","params":{}}
```

### `thread/diff/read`

Params: `{threadId, scope?, against?, commit?, context?, ignoreWhitespace?}`.
Result: `{scope, files, filesOmitted?, untrackedSkipped?, turnId?, stale?,
against?}`. `files` are `{path, oldPath?, status, binary, additions, deletions,
tooLarge?, hunks}`; each hunk keeps its lines with their `" "`, `"+"`, `"-"` or
`"\"` prefix. `committed` needs `commit`; `branch` compares with `against`,
else the worktree's base, the upstream or the default branch, and echoes it.
More than 500 untracked files are counted in `untrackedSkipped` and left out.
Files past the response budget come without hunks (`tooLarge`) or are only
counted (`filesOmitted`). A hunk id from an `ignoreWhitespace` read matches no
action. Reads take no lock and never write the user's index.
Errors: `threadNotFound`, `notGitRepo`; `invalidParams` for a missing `commit`
or no branch to compare with.

```json
{"id":20,"method":"thread/diff/read","params":{"threadId":"THREAD_ID","scope":"uncommitted","context":3}}
```

### `thread/diff/revert`

Params: `{threadId, scope?, against?, commit?, path?, hunkId?, context?, reapply?}`.
Result: `{paths}`. Reverse-applies one hunk, one file, or the whole scope to the
working tree; `lastTurn` without a path undoes the turn, and only while every
affected file is exactly as the turn left it. With `reapply` (`lastTurn` only,
no hunk), the turn's changes apply again instead, and only while every affected
file is exactly as the turn found it. Hunks of renamed, added, deleted,
binary or mode-changed files revert as whole files only. Refused while a turn
runs in the checkout; no turn starts and no tool runs there until it ends.
Errors: `turnInProgress`; `invalidParams` for `staged` and `committed` or a
path outside the diff; `gitConflict` with `diffChanged` or `patchFailed`.

```json
{"id":21,"method":"thread/diff/revert","params":{"threadId":"THREAD_ID","path":"src/a.ts","hunkId":"HUNK_ID"}}
```

### `thread/handoff`

Params: `{threadId, to: "local" | "worktree", branch?, environment?}`. Result:
`{thread, branch?, warnings}`. To the main checkout: the worktree's `HEAD`
becomes a branch checked out there (the worktree's own branch, else `branch`,
else the previous handoff's branch fast-forwarded, else
`<worktrees.branchPrefix><title>`), the uncommitted changes move, and the
worktree stays, detached and clean. Back: the worktree is detached at the main
checkout's `HEAD` and the changes move into it; a thread born in the main
checkout gets a worktree. The changes are saved under `<agentDir>/handoff/`
before anything moves and leave the source only after they landed. The thread
is reloaded where it now runs: subscribers receive `thread/replaced` with the
same id, and queued inputs follow it.
Errors: `turnInProgress`; `invalidParams` for a thread with no message yet or
already on that side; `gitConflict` with `localChanges`,
`operationInProgress`, `branchExists`, `recoveryRequired` (with `data.patch`)
or `worktreeDeleted`.

```json
{"id":22,"method":"thread/handoff","params":{"threadId":"THREAD_ID","to":"local"}}
```

### `thread/worktree/restore`

Params: `{threadId}`. Result: `{thread}`. Rebuilds a deleted worktree at its
old path from its snapshot: detached at the old `HEAD`, with the working files
and the staged state as they were (ignored files were not kept). Then the
thread loads there.
Errors: `threadNotFound`; `invalidParams` when the worktree is not deleted;
`gitConflict` with `worktreeMissing` (deleted without a snapshot: fork the chat
into a new worktree instead) or `submodules`.

```json
{"id":23,"method":"thread/worktree/restore","params":{"threadId":"THREAD_ID"}}
```

### `worktree/list` and `worktree/delete`

`worktree/list {cwd?}` → `{worktrees: [{path, projectCwd, head?, branch?,
threadIds, lastUsedAt, deleted}]}`, the managed worktrees (of `cwd`'s project
when given). `worktree/delete {path}` → `{snapshot?}` deletes one after its
snapshot. A worktree a thread is loaded in, or one holding a nested repository
(an initialized submodule or a repository inside it), is never deleted: archive
and pruning skip it, and `worktree/delete` answers `gitConflict` with
`worktreeInUse` or `submodules`. Only registrations in the managed layout are
removed; the user's own worktrees are never touched.

```json
{"id":24,"method":"worktree/delete","params":{"path":"/home/u/.knightcode/agent/worktrees/ab12/project"}}
```

### `environment/list` and `environment/save`

`environment/list {cwd}` → `{environments, trusted}` reads the project's
`.knightcode/environments.json`; `environment/save {cwd, environments}` writes
it (names unique, at most 50). An untrusted project's scripts never run. See
[Settings](settings.md#worktrees).

```json
{"id":25,"method":"environment/save","params":{"cwd":"/p","environments":[{"name":"node","setup":{"default":"npm ci"}}]}}
```

### `git/*`

Each acts on the thread's own checkout: its worktree, or the user's checkout.
`git/status` → branch, upstream, ahead/behind, staged/unstaged/untracked/
conflicted counts and an operation in progress. `git/stage` and `git/unstage`
take `{threadId, path?, hunkId?, context?}`: no path is everything; paths are
literal. `git/commit {threadId, message?, includeUnstaged?}` stages everything
first unless `includeUnstaged: false`; an empty message is written by the
thread's model from the staged diff, outside the conversation, and the commit
answers `concurrentChange` when the checkout changed meanwhile. The user's
hooks run. `git/push` pushes the current branch with one explicit,
non-forcing refspec and sets the upstream the first time. `git/pr/create
{threadId, title?, body?, draft?}` runs `gh pr create` (`toolMissing` without
`gh`). `git/branches`, `git/branch/create {name}` ("Create branch here"),
`git/branch/switch {name}` (refused when it would overwrite local changes or an
ignored file the branch tracks) and `git/log {limit?}` (the commits since the
base, for the `committed` scope) complete the set.
Errors: `notGitRepo`, `invalidParams`, `authRequired`, `toolMissing`;
`gitConflict` with `diffChanged`, `patchFailed`, `concurrentChange`,
`pushRejected`, `branchExists` or `localChanges`.

```json
{"id":26,"method":"git/commit","params":{"threadId":"THREAD_ID","includeUnstaged":true}}
```

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
