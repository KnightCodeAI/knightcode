# KnightCode desktop app — shell and UI

Status: draft for review
Date: 2026-10-13

The desktop app is an Electron window onto the app server specified in
[architecture.md](./architecture.md). The app server owns every session, turn,
approval, worktree and git operation; this document owns everything the user
sees and touches: processes and IPC in the Electron app, windows, the layout,
the transcript, the composer, approvals, the changes pane, the terminal, the
preview, settings, keybindings, themes, and MCP Apps.

Amended 2026-10-23 by [v1-completion-plan.md](./v1-completion-plan.md): the
built-in panes are native code, as Codex's are, and third-party UI comes from
MCP Apps (that plan's decisions D1-D4). The GUI extension SDK this document
first specified is dropped.

architecture.md section 9 lists what this specification must satisfy. Each of
those requirements is answered here and cross-referenced in section 15.

---

## 0. Mandatory reading

Read completely before editing.

In this repository:

1. `AGENTS.md` — the token floor, Windows rules, keybinding rules, git rules.
2. `apps/desktop/docs/desktop-app/architecture.md` — the app server and its
   protocol. Sections 4 (protocol), 5.4 (approvals), 5.6 (lifecycle), 6
   (worktrees, diffs, git), 8 (extension UI) and 9 (requirements on this
   document).
3. `packages/app-server-protocol/src/protocol.ts` — the wire types the
   renderer imports. The renderer imports nothing else from `packages/`.
4. `packages/cli/src/core/extensions/types.ts:150-301` — `ExtensionUIContext`,
   which section 8 renders.
5. `packages/cli/src/core/keybindings.ts` — the keybinding table, its
   `keybindings.json` override file (`:344`) and its id style
   (`app.interrupt`, `tui.editor.undo`). Section 10 adds `desktop.*` ids.
6. `packages/cli/src/modes/interactive/theme/dark.json`, `light.json`,
   `theme-schema.ts` — the terminal palettes the desktop defaults derive from
   (section 11).
7. `packages/cli/src/extensions/mcp/tools.ts` — MCP tool results, where
   section 12's `mcpApp` detail starts.
8. `packages/cli/src/app-server/approvals.ts:18-26` — the read-only and edit
   tool sets behind the three approval modes.

Prior art, read for structure only; no code is copied:

9. The Codex desktop app (Windows package 26.1007, observed 2026-10-13 by
   static inspection of the installed package and its bundled app server, not
   by driving the UI). Findings used here are marked "Prior art" where a
   decision follows or deliberately departs from it. The findings ledger stays
   outside the repository.
10. OpenCode `packages/gui-extensions/README.md` — terminal, review and browser
    as extensions on one public SDK.

---

## 1. Problem

### 1.1 There is no desktop app

`apps/desktop/` holds only these documents. The app server
(`knightcode app-server`, Phase A) runs many threads in one process and speaks
a stable protocol, but nothing draws it. The IDE that used to be the desktop
product was retired in #313.

### 1.2 The bar users bring

Users arrive from desktop coding agents that already do the following; a
KnightCode window without them reads as a toy:

- many threads across many projects, with the sidebar showing which ones are
  running, blocked on an approval, finished unread, or failed;
- a transcript that collapses tool noise ("Ran 4 commands, edited 2 files")
  and expands to exact commands, output, exit codes and per-file diffs;
- a composer that picks model, thinking level, approval mode and local or
  worktree, queues messages while a turn runs, and steers mid-turn;
- approvals that can allow one command prefix for the thread instead of every
  shell command;
- a changes pane with stage, revert, comment-to-agent, commit and PR;
- an integrated terminal and a local web preview;
- a command palette, rebindable shortcuts, themes.

### 1.3 Three ways to get it wrong

Prior art shows each trap concretely:

- Desktop-side git. Codex's desktop runs git itself in a worker, because its
  app server may live on a remote host. KnightCode's app server is always
  local and already owns git (architecture.md section 6). A second git
  implementation in Electron would race the server's per-checkout queue.
- Broadcast everything to every window. Codex's main process broadcasts every
  server notification to every window. With KnightCode's single-recipient
  approvals (architecture.md section 4.5) that would show one approval in two
  windows, and both could answer it.
- Native code in the renderer. A renderer with Node access turns any XSS in
  rendered markdown or tool output into code execution. Every renderer here is
  sandboxed; Node lives in the main process.

---

## 2. Decisions

| Question | Decision | Rejected, and why |
| --- | --- | --- |
| Runtime | Stock Electron, current stable major, pinned exactly | A custom Chromium shell (Codex's "owl": a browser-engine fork is a team-sized commitment); Tauri (system webviews differ per OS, and node-pty and the terminal need Node anyway) |
| Renderer stack | React + TypeScript + Vite + Tailwind 4 (as `apps/web`), one store fed by protocol notifications | Next.js (server rendering has no role in a local window); a second state library per pane (two sources of truth for one thread) |
| App server process | Main process spawns one bundled `knightcode app-server` child over stdio and is its only client; windows reach it through main | One server per window (architecture.md section 1.1: about 285 MB each, and two servers would fight over session locks); renderer-side spawning (needs Node in the renderer) |
| Window to main transport | One `MessagePort` per window carrying protocol envelopes unchanged plus `host/*` requests (section 4) | Electron `ipcRenderer.invoke` per call (no server-to-window requests, no ordering guarantee with notifications); a second RPC framework (Codex runs capnweb beside a JSON bus: two planes to keep ordered) |
| Notification routing | Sidebar notifications to every window; thread-scoped ones only to windows holding that thread; server requests to exactly one window (section 4.3) | Broadcast to all windows (section 1.3) |
| Git, diffs, worktrees | App server only; the desktop calls protocol methods | Desktop-side git worker (section 1.3) |
| Desktop-only state | One JSON file in Electron `userData`, written atomically (section 7.3) | SQLite (Codex keeps a desktop thread catalog in SQLite: a native module to rebuild per Electron upgrade, and a second copy of what `thread/list` returns) |
| Terminal | xterm.js in the renderer, `node-pty` in main, as Codex 26.1013 loads it (amended 2026-10-23) | A `utilityProcess` extension host (Codex has none; it guards against a native crash at the cost of a process and an IPC hop); the app server's `shell/exec` (architecture.md section 7.2 sizes it for `!` commands, not interactive shells) |
| Web preview | A `<webview>` tag on a per-thread partition, guarded by main's `will-attach-webview`, as Codex's browser is (amended 2026-10-23) | `WebContentsView` (main must hide it under every menu and modal that overlaps it; a `<webview>` stacks in the DOM, and its guest still takes `webContents.debugger` for section 14's L3); an iframe (cannot load arbitrary localhost with the app's CSP) |
| Built-in panes | Native React in the renderer: Changes, files, terminal, preview (amended 2026-10-23) | Built-ins on a GUI extension SDK in sandboxed frames (the first draft of section 12; Codex runs none of its built-ins that way) |
| Third-party UI | MCP Apps: a tool's `ui://` resource drawn in a sandboxed iframe on its own origin, bridged to the app server (section 12) | A KnightCode-only `desktop.json` package type with a `kc-ext://` scheme and an extension host (the first draft); arbitrary HTML from agent extensions (architecture.md section 8.2 keeps agent views declarative) |
| Windows | One primary window; any thread can open in a secondary window; tabs pop out later (section 14) | Pop-out of every tab in v1 (Codex pops out only browser tabs, and pre-warms a hidden window to make it instant: real complexity for a rare action) |
| Packaging | Electron Forge with the Vite plugin and the fuses plugin. Windows: per-user Squirrel installer. macOS: dmg and zip, ad hoc signed until a Developer ID exists, then signed and notarized. Linux: deb and rpm | MSIX on Windows (package identity, Store certification, and binaries under `WindowsApps` that Codex copies out to `%LOCALAPPDATA%` before it can run them); electron-builder (a third-party layer over what Forge does first-party) |
| Updates | Electron `autoUpdater` on Windows against a knightcode.dev feed over GitHub releases tagged `desktop-v*`; on macOS, until the app is signed, the same feed drives an "Update available" banner; Linux updates through the package manager | Update checks inside the app server (it would update itself mid-session); update.electronjs.org (it serves the repository's newest release, a CLI release here) |
| Login | The app server's `account/*` methods; the desktop shows their prompts | Desktop-side OAuth (two credential stores) |

---

## 3. Terminology and ownership

```text
Main            the Electron main process. Node. No UI.
Renderer        one per window. Sandboxed, no Node. All pixels.
App server      the knightcode app-server child (architecture.md).
Project         a folder the user added to the sidebar. Threads are listed
                under the project whose path equals their projectCwd.
Tab             a pane in a thread's side panel: Changes, a file, a
                preview, an MCP App; terminals have the bottom region.
```

### Main

Owns:

- the app server child: spawn, restart, logs, quit (section 5);
- windows, menus, tray, dock, deep links, single-instance lock (section 6);
- routing between windows and the app server (section 4);
- the desktop state file (section 7.3);
- native dialogs, clipboard, `shell.openExternal`, open-in-editor;
- terminal PTYs (section 9.7);
- the guards on preview `<webview>` guests and their captures (section 9.8);
- the `kc-mcp-app://` protocol serving MCP App HTML (section 12).

### Renderer

Owns:

- every pixel, every keystroke, keybinding dispatch;
- the client store: the threads it holds, their turns and items, built from
  `thread/resume` snapshots plus notifications (section 7.1);
- which threads are on screen, and so which it holds (section 4.3).

A renderer never spawns a process, reads a file, or speaks to the network
except to `app://`, to the MCP App frames it embeds, and to the pages its
preview `<webview>`s load.

---

## 4. IPC

### 4.1 The window port

At window creation main makes a `MessageChannelMain`, keeps one end, and posts
the other to the window's preload with `webContents.postMessage`. The preload
forwards it to the page once, through `window.postMessage`, and exposes
nothing else; there is no `contextBridge` API besides a frozen
`window.knightcode = { platform, windowId }`.

Every message on the port is one of:

```ts
type PortMessage =
	| Message                                 // an architecture.md section 4.1 envelope, unchanged
	| HostRequest | HostResponse;             // section 4.4

interface HostRequest { id: number; host: HostMethod; params: unknown }
type HostResponse = { id: number; result: unknown } | { id: number; error: { code: string; message: string } };
```

Main checks on every message that the sending frame is the window's top frame
and its origin is `app://desktop`. Anything else is dropped and logged.

### 4.2 Requests to the app server

Main is the app server's only client, so window request ids must not collide.
Main rewrites each forwarded request's id to `"w<windowId>:<id>"` and restores
it on the response. String ids keep the 128-code-point limit of architecture.md
section 4.1; a window id plus a 100-code-point client id fits.

`initialize` and `initialized` are main's own and happen once per app server
process (section 5.2). A window's `initialize` is answered by main from the
cached result, so a renderer reload costs no server round trip.

### 4.3 Holding threads and routing

A window holds a thread from the response to its `thread/start`,
`thread/resume`, `thread/fork` or `turn/start` until it sends
`thread/unsubscribe` or closes. Main counts holders per thread:

- First holder: the request goes to the server as sent.
- Further holders: `thread/resume` still goes to the server, which returns a
  fresh snapshot and keeps the one subscription it already has; main does not
  double-count it.
- Last holder releasing: main sends `thread/unsubscribe` to the server. Any
  other holder releasing is answered by main with `{status: "unsubscribed"}`.

Routing out of main:

| Message | Goes to |
| --- | --- |
| Response | the window that sent the request |
| Sidebar notification (architecture.md section 4.5) | every window |
| Thread-scoped notification | every window holding that thread |
| `thread/replaced` | every window holding the old id; main moves their holds to the new id |
| Server request (`item/toolCall/requestApproval`, `ui/dialog`) | one window: the one that sent the last `turn/start` on that thread if it still holds it, else the focused holder, else the most recently focused holder |
| `serverRequest/cancelled` | the window the request went to |

When the window a server request went to closes or releases the thread, main
moves the request to the next holder by the same rule and sends
`serverRequest/cancelled` to the old window if it is still open. With no
holder left, main's release sends `thread/unsubscribe`, and the server
withdraws the request itself (architecture.md section 4.5).

When a server request arrives for a window that is not focused, main flashes
its taskbar entry and posts an OS notification ("Approval needed in
<thread name>"); clicking it focuses the window on that thread.

### 4.4 Host methods

Calls the renderer cannot make itself. Main validates every `params` against a
TypeBox schema in `apps/desktop/src/shared/host-protocol.ts`; an unknown method
or invalid params answers `invalidParams`.

| Method | Params → result |
| --- | --- |
| `host/dialog/openFolder` | `{title?}` → `{path?}` |
| `host/dialog/openFiles` | `{filters?, multiple?}` → `{paths}`; used for image attachments, sent as `{path}` images (architecture.md section 4.2) |
| `host/shell/openExternal` | `{url}` → `{}`; http, https and mailto only |
| `host/shell/showInFolder` | `{path}` → `{}` |
| `host/openIn/list` | `{}` → `{targets: {id, name, kind, icon?}[]}`; `kind` is `editor`, `terminal`, `fileManager` or `systemDefault` (section 9.9) |
| `host/openIn/open` | `{targetId, path, line?, column?}` → `{}` |
| `host/clipboard/writeText` | `{text}` → `{}` |
| `host/clipboard/readImage` | `{}` → `{path?}`; writes a pasted image to a private temp file |
| `host/window/open` | `{route}` → `{windowId}` |
| `host/window/setTitle` | `{title}` → `{}` |
| `host/notify` | `{title, body, threadId?}` → `{}` |
| `host/state/read` / `host/state/write` | section 7.3 |
| `host/preview/capture`, `host/keys/set` | section 9.8 (v1-completion-plan.md 4.2) |
| `host/terminal/*` | section 9.7 (v1-completion-plan.md 4.2) |
| `host/mcpApp/serve` / `host/mcpApp/release` | section 12 (v1-completion-plan.md 4.2) |
| `host/update/check` / `host/update/install` | updates (v1-completion-plan.md Task S4.2) |
| `host/app/info` | `{}` → `{appVersion, serverVersion, platform, logsDir}` |
| `host/app/relaunch` | `{}` → never answers |

Host methods never touch session files, settings files or git; those go
through the app server.

---

## 5. The app server child

### 5.1 Spawn

- Binary: `<resources>/knightcode/knightcode[.exe]`, beside `knightcode.version`
  (architecture.md section 9). Never a `knightcode` on PATH. In an unpackaged
  development build only, `KNIGHTCODE_DESKTOP_SERVER` may name a command such
  as `bun packages/cli/src/cli.ts`; `app.isPackaged` ignores it.
- Arguments: `app-server`. Nothing else; configuration is the user's
  settings, so the desktop and the terminal behave alike.
- Environment: on macOS and Linux a GUI app does not inherit the login
  shell's `PATH`, so tools the agent runs would be missing. Main resolves the
  login shell environment once at startup (`$SHELL -ilc env -0`, 5-second
  timeout, falling back to `process.env`) and passes it. On Windows the
  process environment is used as is. Main adds `KNIGHTCODE_CLIENT=desktop`.
- stdio: stdin and stdout are the protocol; stderr goes to
  `<logsDir>/app-server.log`, rotated at 5 MiB, five files kept.

### 5.2 Handshake

Main sends `initialize` with `clientInfo {name: "knightcode-desktop",
version}` and checks `serverInfo.version` against `knightcode.version`. A
mismatch (only possible in development) shows the error screen of section 5.3.
Main caches the result for windows (section 4.2).

### 5.3 Exit and restart

An exit main did not ask for:

1. Every request in flight fails in its window with a host-side error
   `serverRestarted`.
2. Every window shows a banner: "Reconnecting to KnightCode…".
3. Main respawns after 0.5 s, doubling to a 20 s cap, with ±20 % jitter. The
   delay resets after 60 s of healthy running.
4. After the handshake, main re-sends `thread/resume` for every held thread
   and delivers each fresh snapshot to its holders. A turn that was running
   reads back `interrupted` (architecture.md section 4.2); the transcript
   shows "KnightCode restarted while this turn was running".
5. Five exits within two minutes stop the loop: a full-window error screen
   with the log path, "Open logs" and "Restart".

Prior art: Codex reconnects remote hosts with this backoff but leaves the local
server to respawn lazily on the next request; a user then learns of the crash
only when they next type. Respawning eagerly keeps the sidebar live.

### 5.4 Quit

If any thread is `active`, quitting asks "N threads are running. Quit and
interrupt them?". Then main closes the child's stdin and waits for it to exit;
the server's own 10-second deadline (architecture.md section 5.6) bounds the
wait, and main kills the child 2 s after that.

---

## 6. Windows and chrome

### 6.1 Single instance and deep links

`app.requestSingleInstanceLock()`. A second launch forwards its arguments to
the first and exits. Arguments and `knightcode://` links:

| Input | Effect |
| --- | --- |
| a folder path | add it as a project and open a new thread in it |
| `knightcode://thread/<id>` | focus the window holding it, or open it in the window used last |
| `knightcode://new?cwd=<path>` | new thread composer in that project |
| `knightcode://settings/<page>` | open settings |

Links that arrive before the primary window is ready are queued. An installed
app registers the scheme at launch on Windows and Linux
(`setAsDefaultProtocolClient`) and through Info.plist on macOS
(`forge.config.ts`); a source checkout does not, as it would register the bare
Electron binary. macOS delivers links to the running app as `open-url`. Main
hands a link to the page as the `navigate` host event, and
`renderer/routes.ts` turns it into a view; "Copy deeplink" (section 9.3) makes
the thread links.

"Open in new window" (section 9.3) opens another window on a thread through
the same path: `host/window/open` creates a window whose route is the
thread's link.

### 6.2 Window

- Size: 1280×820 by default, clamped to 85 % × 80 % of the display work area;
  bounds and maximized state restored per window kind.
- Windows: `titleBarStyle: "hidden"` with `titleBarOverlay` (native caption
  buttons), Mica background on Windows 11 when the theme allows translucency.
  macOS: `hiddenInset`, traffic lights inside the sidebar header. Linux: the
  system frame.
- Close: closing the last window quits on Windows and Linux; on macOS the app
  stays in the dock. No tray in v1.
- Menu: File, Edit, View, Window, Help, every item bound to a keybinding id
  (section 10). On Windows and Linux the menu is hidden behind Alt.
- A renderer that crashes is reloaded once automatically; a second crash
  within a minute shows "This window stopped working — Reload".

### 6.3 Security

Every `BrowserWindow`:

```ts
webPreferences: {
	sandbox: true,
	contextIsolation: true,
	nodeIntegration: false,
	webSecurity: true,
	preload: PRELOAD,
}
```

- The renderer loads from a privileged `app://desktop/` protocol that serves
  only the built renderer directory and rejects `..` segments; never
  `file://`.
- CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src
  'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
  connect-src 'self'; frame-src kc-mcp-app:; worker-src 'self' blob:`.
- `webviewTag` is on for app windows (the preview, section 9.8); main's
  `will-attach-webview` strips any preload, forces `nodeIntegration` off,
  `contextIsolation` and `sandbox` on, and refuses a partition outside
  `persist:kc-preview:<threadId>` or a source that is not http, https or
  `about:blank`.
- `will-navigate` is prevented unless the target is the page's own URL (a
  reload: Vite's, or the store's after a hot update); `setWindowOpenHandler`
  denies, opening http and https links with `shell.openExternal`.
- `session.setPermissionRequestHandler` denies everything except
  `clipboard-sanitized-write` and `notifications`.
- Fuses: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off,
  `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation`
  on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on.
- Markdown and tool output are rendered as text nodes or sanitized markdown;
  no `dangerouslySetInnerHTML` outside the markdown renderer, which allows no
  raw HTML.

---

## 7. State

### 7.1 Client store

One store per renderer, a reducer over protocol messages. Per held thread it
keeps the `Thread`, turns in order, and each turn's items ordered by `index`
(architecture.md section 4.2): an `item/completed` whose index differs from
the provisional one replaces its times, text, fileChanges and index and
moves the item; `item/removed` deletes it; deltas append
to the item named by `itemId`. A `TurnReference` or `ItemReference` stays a
placeholder ("Large turn — Load") until the user expands it, which reads
`payload/read` chunks.

Resume follows architecture.md section 4.5 exactly: install its live `queue`
snapshot, including an empty snapshot that clears stale composer entries.
Notifications that arrive while a referenced running-turn snapshot is being
fetched, including queue updates, are buffered and replayed after the snapshots
are installed. Queue state is live only, never reconstructed from history.

Sidebar data (thread summaries, status, names, latest outcomes) lives in a
second slice fed by `thread/list` pages and sidebar notifications, independent
of holds. `thread/turn/completed` routes its bounded summary to every window.
On startup/reconnect, read the newest `thread/read` page for visible rows,
with at most two reads in flight; never load or subscribe every sidebar
thread. Reuse `TurnReference` summary fields without fetching payloads.
Retain the latest outcome notification during a row's read and apply it
afterwards, so an older snapshot cannot replace a newer completion. Hidden
rows initialize when they become visible.

### 7.2 Optimistic messages

The composer renders a sent message at once, marked pending, with a
`clientMessageId` (architecture.md sections 4.2 and 4.4). The
server carries the id on the message object built from that input, never by
matching text, so it survives hooks, template expansion and duplicate text.
The pending message is resolved by exactly one of:

- the `userMessage` item that echoes its id: the item replaces it;
- a request error: it becomes "Not sent — Retry · Edit";
- `turn/start` answering `handled` or `cancelled`, or a queued message's
  `turn/queue/remove` answering `removed: true`: it is removed, since no
  message was created from it;
- a `turn/start` that started a run on a replacement thread (a command that
  replaced the session dispatches its own text, which carries no id), or
  `turn/completed` for the request's turn without an echo: it is removed, and
  the transcript shows the messages the run actually created.

There is no fallback that matches by text or by order.

### 7.3 Desktop state file

`<userData>/desktop-state.json`, written atomically (temp file then rename),
debounced 500 ms, schema-versioned:

```ts
interface DesktopState {
	version: 1;
	projects: { path: string; name?: string; pinned: boolean; collapsed: boolean }[];
	pinnedThreads: string[];
	lastSeen: Record<string, string>;     // threadId -> last turn id the user saw completed
	unread?: string[];                    // threads with an unseen outcome, or marked unread (section 9.2)
	windows: { kind: "primary" | "thread"; bounds: Rectangle; maximized: boolean; tabs: TabState[] }[];
	sidebar: { width: number; organize?: "project" | "list"; sort?: "updated" | "created" }; // section 9.2
	panels: { rightWidth: number; bottomHeight: number };
	preferences: DesktopPreferences;      // section 9.10
}
```

`DesktopPreferences` holds the theme mode, the send key, queue or steer, "Show
Full access in the composer", `keybindings` (a binding id's keys replacing its
defaults; `[]` unassigns it, section 10) and `appearance` (a customization per
light and dark theme, section 11.3).

A corrupt file is renamed `desktop-state.corrupt-<time>.json` and defaults
apply; nothing in it is needed to recover a thread. Agent settings (models,
approval defaults, extensions, worktree settings) are not here: they are the
user's `settings.json`, read with `config/read` and written with
`config/write` (architecture.md).

---

## 8. Extension UI from agent extensions

architecture.md section 8.1 maps `ExtensionUIContext` onto `ui/*` messages.
The desktop renders them as follows:

| Message | Desktop |
| --- | --- |
| `ui/dialog` select | modal with a filterable list, Enter picks, Esc cancels |
| `ui/dialog` confirm | modal with the two buttons named by the extension |
| `ui/dialog` input / editor | modal with a one-line field / a multi-line editor |
| `ui/notify` | toast, 5 s, errors stay until dismissed |
| `ui/state` status | chip in the thread header, keyed by its key alone (architecture.md section 8.1), sorted by key as the terminal footer sorts them |
| `ui/state` title | the window title while the thread is open in that window |
| `ui/state` working message, working visibility | the text of the row shown under a running turn while the model works ("Thinking" by default); `workingVisible: false` hides that row |
| `ui/widget` lines | panel above the composer, monospace, at most 10 lines per widget as in the terminal |
| `ui/widget` view | the same panel rendering the `View`; its buttons and fields send `ui/event` |
| `ui` in a `thread/start`, `thread/resume` or `thread/fork` result | installed as the thread's UI, then changed by `ui/state` and `ui/widget` |
| tool result or extension message `details.view` | rendered in place of raw output or markdown in the transcript, with its buttons and fields disabled |
| load `warnings` in a `thread/start`, `thread/resume` or `thread/fork` result | a dismissible banner at the top of the thread, one line per warning, with the file and line when known; dismissed per window |
| `warning` notification | a toast; with a `threadId`, it also adds to that thread's banner |

`View` rendering uses the same components as the rest of the UI: `text` tones
map to theme tokens, `markdown` uses the transcript renderer, `table` is a
plain table, and in a widget `button` and `field` send `ui/event`. Widgets
show in one panel, `aboveEditor` ones first; the protocol keeps `placement`
for the terminal. Modals are in-window, not OS dialogs, so they follow the
theme and keybindings.

Prior art: Codex lets plugins ship arbitrary HTML apps in a sandboxed frame,
declared on MCP tools. Agent extensions here stay declarative (architecture.md
section 8.2); arbitrary UI comes, as in Codex, from MCP Apps (section 12) of
MCP servers the user configured knowingly.

---

## 9. Layout and screens

### 9.1 Shell

```text
+------------+------------------------------------------+-------------+
| sidebar    | tab strip                                 | right panel |
|            +------------------------------------------+ (toggle)    |
| projects   | thread transcript                         | changes     |
|  threads   |                                           | plan/status |
| pinned     |                                           |             |
| needs      |                                           |             |
|  attention |                                           |             |
|            +------------------------------------------+             |
|            | composer                                  |             |
|            +------------------------------------------+             |
|            | bottom panel (terminal tabs, toggle)      |             |
+------------+------------------------------------------+-------------+
```

Title bar (Windows and Linux): back, forward and sidebar toggle at the left,
then the menu, then the native caption buttons; the rest of the bar drags the
window. On macOS the three buttons sit right of the traffic lights.

Prior art, observed in screenshots of the running Codex app (2026-10-13): a
title bar with back, forward, sidebar toggle and an inline menu; a narrow
icon rail left of the sidebar for its other products; a sidebar headed by a
product name, a notifications bell and search; "Projects" and "Recents"
sections; thread rows that reveal pin and archive on hover and show a hover
card with the full title, project and age; an empty state of one icon and
"What should we build?" above the composer. KnightCode takes the title bar,
the hover actions, and the empty state, and keeps a narrow rail with only Home
and the profile menu (settings, help, sign-in); there is one product, so no
other rail pages.

All three side regions resize by dragging and collapse by keybinding. As in
Codex, a drag stops at the region's minimum width (290 px for the sidebar,
counting the rail; 320 px for the side panel and 200 px for the Changes file
tree), and dragging on until the region would be under half of that minimum
slides it shut; dragging back opens it again. The side panel also stops where
it would leave the chat 352 px; dragged on until the chat would be under 160
px, it takes the chat's place (full screen), which its Enter/Exit full screen
button also toggles. Neighbours keep their room when nothing is dragged too:
however the thread view narrows, the side panel leaves the chat 352 px, and the
file tree never takes more than 60% of the Changes pane. The
main area is a tab strip. In v1 a tab is one of: thread, changes, terminal,
preview, file, settings, extension tab. A tab can be dragged into the right
or bottom region, so a terminal can sit beside the transcript. Tabs and
their placement restore on relaunch; a tab that cannot be restored shows
"This tab couldn't be restored".

### 9.2 Sidebar

Laid out as Codex's (measured 2026-10-19): the product name and Search, "New
thread", then four sections that fold from their headers (folds are
remembered): Pinned and Needs attention (hidden when empty), Projects (each
project folds too and lists its threads newest first, "Show more" after 10),
and Recents (threads outside every project). Needs attention holds threads
waiting on the user (approval or dialog) and `systemError` ones. The column
resizes from its right edge (double-click resets it to 276 px) and hides with
`desktop.sidebar.toggle`; width, folds and visibility live in desktop state.
`renderer/sidebar-model.ts` works the sections out apart from the component, so
the go-to-thread shortcuts and the command palette number threads as the
sidebar shows them, and the other thread shortcuts (section 10) step through
the same order.

The … on the Projects and Recents headings is Codex's sidebar options menu:
Organize sidebar › (By project, In one list) and Sort threads by › (Last
updated, Created), both remembered (`sidebar.organize`, `sidebar.sort`). In
one list hides Projects and lists every unpinned thread under Recents. Codex's
"Manual order" (drag to reorder), the "Show › Projects" toggle and custom
sections are not ported.

Resting the pointer on a row opens Codex's hover card beside it (Radix's
delays): a thread's whole title and when it last changed, its project, its
worktree, and its state (working, waiting on you, the system error); a
project's name, folder, and thread and active counts.

Ctrl-click (Cmd-click on macOS) adds a thread to a selection and Shift-click
selects a range from the last one toggled, in sidebar order; a plain click or
Escape clears it. With more than one selected, a selected row's Archive and
right-click menu archive the selection after Codex's confirmation ("Archive 3
threads?").

Thread rows are 30 px nav rows with no time (as Codex's): the title fades out
when too long, and one status mark sits at the end: a spinner (active), an
amber dot (waiting on you), a red dot (`systemError`), Codex's blue 8 px dot
(unread), a branch glyph (worktree thread). Pin and Archive replace the mark
on hover. Right-click opens a native menu with the thread's actions, the
header menu's (section 9.3) without the ones that need the open thread, each
with its shortcut.

Unread: a `thread/turn/completed` for a thread not on screen marks it unread
(`DesktopState.unread`); opening it clears the mark. "Mark as unread"
(`desktop.thread.markUnread`) sets it by hand ("Mark as read" clears it, with
no shortcut, as Codex's), and `desktop.thread.clearUnread` clears every mark.
The `lastSeen` read-back baseline above is not built: marks come from live
outcomes only.

Project rows: name, fold, and on hover a … menu (New thread, Show in folder,
Archive threads, Remove project) and "Start new thread in <project>"; the same
items on right-click. Archive threads asks first, as Codex's "Archive chats"
("Archive 4 threads?", or "Stop and archive …" when some run, which stops
them), then says how it went in a toast. Remove asks first ("This only removes
the project from the sidebar. Files on your computer and existing threads won't
be deleted.").

Archived threads are a settings page (section 9.10), as Codex keeps archived
chats in its settings.

Search filters names client-side in v1; full-text search is section 14.

### 9.3 Thread view

Header: thread name (click to rename), project and branch or worktree badge,
model, the approval mode chip, extension status chips (section 8), a toggle
for the right panel, and a menu. The menu groups its items with separators
and shows each item's keybinding at the right (`renderer/components/
thread-actions.tsx`): Rename, Pin, Mark as unread; Fork › (Fork thread, Fork
thread in new worktree), Compact; Copy › (deeplink, Markdown, working
directory, conversation path, thread id), Show in folder, Open in new window;
Archive, Delete…. Delete asks first and deletes for good; as the server deletes
only archived threads, a live one is stopped and archived first. Prior art:
Codex's thread menu (measured 2026-10-19) has this shape, plus side chats,
scheduled tasks, sharing, "Move to right pane" and Open in ›, which are
section 14 or not planned; Codex lists Delete and "Copy conversation path" as
commands only. The conversation path is the thread's `sessionFile`.

Transcript, by item type:

| Item | Rendering |
| --- | --- |
| `userMessage` | right-aligned bubble; images as thumbnails; actions: copy, fork from here |
| `agentMessage` | markdown (GFM, code blocks with copy and language label, syntax highlighted); streams in place |
| `reasoning` | collapsed row "Thinking" while streaming, then "Thought" (no duration: the item's times are its whole assistant message's, architecture.md section 4.6); expands to the text in a muted style |
| `toolCall` read-only (`read`, `grep`, `find`, `ls`) | one line "Read src/app.ts", "Searched for 'x' in src" |
| `toolCall` `bash` / `powershell` | "Running `npm test`" then "Ran `npm test` in 4.2s"; expands to `$ command`, cwd, output with ANSI colours, exit code or "Interrupted" |
| `toolCall` `edit` / `write` | "Edited src/app.ts +12 −3"; expands to the file's diff from `fileChanges`; a link opens it in the changes pane |
| `toolCall` other | tool name and a one-line input summary; expands to Input and Output; `view` replaces Output when present |
| `toolCall` nested (`parentItemId`) | indented under its parent, collapsed with it |
| `compaction` | divider "Context compacted" expanding to the summary |
| `extensionMessage` | labelled with the extension name; markdown or its `view` |

Grouping: a completed turn shows as three parts. First a quiet row, "Worked
for 2m 14s ›", from the turn's `startedAt` and `completedAt`.
Below it, under a divider, the turn's final `agentMessage`, always visible.
The row expands to everything else in the turn, in order: the agent's
progress messages ("I found eight independent change sets…") and, between
them, each run of consecutive tool calls collapsed to one line ("Ran 3
commands, read 4 files, edited 2 files") that expands to the rows of the table
above. While a turn runs, the work section is expanded and the newest item is
in view; it collapses when the turn completes. Under the final message: copy,
a … menu with Codex's "Branch in new thread" (a fork up to the end of that
turn), and the completion time.

Prior art, observed in Codex (screenshots, 2026-10-13): the same "Worked for"
row and final answer below a divider, but the expanded row shows only the
progress messages; commands and edits are not in the transcript at all.
KnightCode keeps the tool rows inside the group, one level down, because
seeing exactly what ran is part of trusting an agent with full access.

Status rows: `turn/retry` shows "Retrying in 4s (attempt 2 of 3)";
a failed turn shows its `error.message` and an action chosen by `error.kind`:
`auth` offers "Sign in", `contextOverflow` offers "Compact and
retry", `rateLimit` and `network` offer "Retry", anything else "Retry".
`threadLockedElsewhere` on resume shows "This thread is open in another
KnightCode process" with "Fork it" and "Retry" (architecture.md section 5.5).

Scrolling: the transcript sticks to the bottom while streaming unless the
user scrolled up; a "Jump to latest" button appears then. Long transcripts
are virtualized; history pages load when scrolled to the top
(`thread/resume` cursors).

Context indicator: a ring in the composer footer filled to
`contextTokens / contextWindow` from `thread/tokenUsage/updated`; hover:
"38% of context used (76k / 200k) · $0.42 this thread".

### 9.4 Composer

```text
  [project v]  [Local v]                       (new threads only)
+----------------------------------------------------------------+
| [queued: "also update the docs"  Edit · Steer now · Remove]    |
| Ask KnightCode to do anything. @ for files, / for commands     |
|                                                                 |
| [+] [Ask v]                       [model · thinking v]  [Send]  |
+----------------------------------------------------------------+
| main · 3 uncommitted                                            |
+----------------------------------------------------------------+
```

Prior art: Codex's composer (screenshot, 2026-10-13) puts the project and
run-location pickers in a tab-like row above the input, attach and the
approval mode at the bottom left, and one button naming the model and its
effort ("<model> Light") at the bottom right beside dictation. KnightCode
follows that arrangement; it has no voice buttons in v1 (section 14).

- Model and thinking: one button naming both ("<model> · High"). It opens a
  popover: the thinking level as a slider whose stops are the model's
  `thinkingLevels`, the level's name above it, and the model
  name, which opens the model list (grouped by provider from `model/list`,
  searchable, recent first, a check on the current one). No model is
  preselected by the desktop: a new thread uses the server's default, and
  with none the button reads "Choose a model" and Send is disabled. Prior
  art: Codex's popover has this slider-plus-model shape (screenshot,
  2026-10-13); its list opens with a "Default: recommended set of models"
  entry, which KnightCode does not have (the user picks every model).
- Approval mode: a popover titled "How should KnightCode act?" listing Ask,
  Auto-edit and Full access, each an icon, a name and one line of
  explanation, a check on the current one, Full access in `--kc-danger`.
  Switching to Full access asks once per thread: "KnightCode will run
  commands and edit files without asking." Full access is offered only when
  the Approvals setting allows it (section 9.10). The choice applies with
  `thread/settings/update`, mid-turn included.
- Workspace (new threads only): Local, or New worktree (Phase B), with the
  base branch and "Carry over uncommitted changes". Outside a
  git repository only Local is offered.
- `@` opens a file picker backed by `file/search`, sending a
  `searchId` per composer so each keystroke supersedes the last; choosing
  inserts `@path`, which the agent's input handling already understands.
  When a result is `truncated`, the picker says "Some files may be
  missing" under the list.
- `/` opens the command list from `command/list` (extension commands, prompt
  templates, skills); choosing inserts the command text.
- `+` attaches images: file dialog, paste, or drop. Images go as `{path}`
  so large screenshots never cross the window port as base64. Files dragged
  over the composer veil it with "Drop files to attach"; dropped images
  attach and other files are inserted as `@` mentions at the caret, relative
  to the project when inside it. The preload reads a dropped file's path
  (`webUtils.getPathForFile`), as the page cannot.
- While a turn runs, Send becomes Queue: the message waits on the server
  (`turn/queue/add`) and starts its own turn when this one ends. Mod+Enter
  sends it as a steer (`turn/steer`) into the running turn instead.
  Initialize queued messages from resume's required `queue` snapshot, then
  apply `turn/queue/updated` in order. Empty snapshots clear stale entries.
  Queued messages show above the input as Codex's rows: the text on one
  line, Steer, Delete, and a … menu with Edit message, which puts the text
  back in the field ahead of anything typed. Stop drops the queue; put the
  queued texts back in the composer, as the terminal's Escape does. Edit and Steer are a
  `turn/queue/remove` followed by a new queued input or steer. Remove succeeds
  until the input starts its turn; `removed: false` means it already started,
  and its turn follows. A preference flips the default between
  queue and steer.
- Esc while a turn runs and the input is empty interrupts (`turn/interrupt`
  with the running `turnId`).
- Footer: branch and uncommitted count for the thread's cwd (Phase B
  `git/status`), click opens the changes pane.
- Send key: Enter sends and Shift+Enter is a newline, or the reverse
  (preference).
- The field is plain text, as Codex's with "Plain text composer" on; Codex's
  rich mode (Markdown formatted while typing, on ProseMirror) is not ported.
- Drafts persist per thread in the renderer's memory and across reloads in
  `sessionStorage`.

### 9.5 Approvals

`item/toolCall/requestApproval` renders as a card in the composer's place, as
Codex shows a request (the composer stays mounted underneath, so a draft
survives), and the thread's sidebar row shows "Waiting on you":

```text
+--------------------------------------------------------------+
| [>_] Run command                                              |
| Allow KnightCode to run this command?                         |
|   npm test -- --watch=false                                   |
|   in app                                                      |
| flagged by the classifier gate (the reason, when present)     |
|                               [Deny Esc]  [Allow once Enter|v] |
+--------------------------------------------------------------+
```

- Buttons come from the request's `decisions`; the desktop never
  offers a decision the server did not list.
- `bash` and `powershell` show the command; `edit` and `write` show the path
  and the proposed diff when the input carries one; other tools show the
  input as formatted JSON.
- "Allow `<prefix>` for this thread" appears when the server offered a
  `prefix`. "Allow `<tool>` for this thread" is offered for
  non-shell tools.
- The arrow beside Allow once holds the longer-lived allowances and "Deny and
  say what to do instead…", which opens a field; the text is sent as the
  decline `message`.
- Enter allows once; Esc denies. Both only while the card has focus, which it
  takes when it appears unless the user is typing in the composer.
- `serverRequest/cancelled` removes the card with "Request withdrawn".

### 9.6 Changes pane (Phase B)

Opened from the composer footer, a tool row, or a keybinding; a right-region
tab by default. Opening the right region narrows the thread to a column; the
composer then shows its controls as icons only.

```text
+--------------------------------------------------------------+
| [Changes x] [+]                                    [split]   |
| [Uncommitted v  +120 -8]  [feature -> main v]     [...]      |
| ! Showing tracked changes only (854 untracked files skipped) |
|   [Refresh]                                                  |
| src/app.ts  +48 -0  [viewed] [open] [...]  | [Filter files]   |
|  ^ 9 unmodified lines                      | v src           |
|  10  statusBadgeClass,                     |   app.ts  +48   |
|  13 +expectedOutputLabel,                  |   util.ts +3 -1 |
|  v 253 unmodified lines                    |                 |
+--------------------------------------------------------------+
```

- Source picker, showing the source's +/− totals: "This thread's last turn"
  (`turn/diff/updated` files), "Uncommitted", and for worktree threads "All
  changes on <branch>", compared against a base chosen in the second picker.
  The last-turn view says "Files that changed while this turn ran", as
  architecture.md section 6.2 requires.
- A repository with more than 500 untracked, not ignored files shows tracked
  changes only, with a banner naming the count and a Refresh button, so the
  pane stays responsive when a build output is missing from `.gitignore`.
- The diff shows each file under a header (path, +/− counts, mark as viewed,
  open in editor, menu); unchanged runs fold into "N unmodified lines" bars
  that expand in either direction. A file tree on the right has a filter and
  per-file counts; selecting a file scrolls to it. The diff view is split or
  unified, automatically unified when the pane is narrow.
- A large diff (Codex's limits: more than 128 files, 9,000 changed lines or
  12 MiB of changed text) shows one file at a time under a "This diff is
  large, showing one file at a time" banner with previous and next buttons;
  selecting a file in the tree shows that file instead of scrolling.
- Prior art: this layout follows Codex's Changes tab (screenshot,
  2026-10-13), including its untracked-files banner.
- Per hunk and per file: stage, unstage, revert (`git/stage`, `git/unstage`,
  `thread/diff/revert`). Revert confirms with "Don't ask again" (preference).
- Select lines and comment; comments collect into a tray, "Send N comments"
  calls `thread/diff/comment`.
- Commit: message field ("Leave blank to generate"), "Commit" and "Commit and
  push"; PR: title and body (blank to generate), "Create PR" and "Create draft
  PR". `toolMissing` for `gh` shows how to install it.
- Worktree threads: "Hand off to <branch in main checkout>" with Merge or
  Apply, a step list while it runs, and `gitConflict` paths with
  `recoveryInstructions` shown verbatim when it fails.

### 9.7 Terminal

- Bottom region, spanning the thread and the side panel, as Codex's bottom
  panel (26.1016, measured): 280px until dragged, at least 160px, shut when
  dragged under 80px, a 16px handle on its top edge, a 40px strip of the side
  panel's tabs (each named by its shell and cwd), + and a shell menu, and a
  chevron that hides the region; closing the last terminal hides it too.
  Ctrl+\` (Control on macOS too, Codex's Open Terminal) opens a terminal in
  the thread's cwd; Mod+J toggles the region. Whether it shows is each
  thread's own, and only with that thread's terminals, as Codex keeps its
  bottom panel per conversation.
- xterm.js in the renderer; `node-pty` in main (`host/terminal/*`), as Codex
  runs it. Colours from the `--kc-terminal-*` and `--kc-ansi-*` tokens, which
  follow Codex's palette: the ANSI slots are the theme's accents (black and
  bright black the tertiary and secondary text, cyan the blue), so light and
  dark both follow the theme. Codex's padding (8px over, 16px before, 12px
  under) and copy and paste: copy only with a selection, so Ctrl+C without
  one still interrupts the shell; keys the shell gets never reach window
  bindings. Off macOS a bare Ctrl+letter is the shell's (readline's Ctrl+K,
  Ctrl+B, Ctrl+N, Ctrl+J; tmux's Ctrl+B), as in Codex's terminal; Ctrl+\`,
  Ctrl+PageUp/PageDown and the Shift chords still reach the window. A preview's
  page keeps a bare Ctrl+letter the same way, except the preview's own Ctrl+T and
  Ctrl+L.
- Shell: the preference, else `pwsh`, then `powershell`, then `%COMSPEC%` on
  Windows; `$SHELL`, then `/bin/bash`, then `/bin/sh` elsewhere. Git Bash and
  WSL are offered in the menu on Windows when found.
- Each terminal belongs to a thread (its cwd) and survives window reloads:
  main keeps 64 KiB of scrollback and replays it on reattach. Terminals end
  when their thread is archived or deleted, or the app quits.
- A terminal whose cwd is outside the thread's workspace says so, with
  Codex's Dismiss and Open new terminal; one whose shell ended offers Restart.

Status (2026-10-23): built in S3.

### 9.8 Preview

A preview tab in the side panel holds a `<webview>` on the partition
`persist:kc-preview:<threadId>` (one per thread, so a sign-in carries across a
thread's tabs; cleared when the thread is deleted), guarded by main (section
6.3), with:

- an address bar (Mod+L), back, forward, reload, open in browser;
- navigation limited to http and https (the address bar checks before it
  loads, since main's `will-navigate` never sees `loadURL`; main refuses
  page navigations and redirects to anything else); permission requests denied;
  downloads ask through a native save dialog;
- "Annotate": select a region; main captures it from the guest with
  `webContents.capturePage` (`host/preview/capture`, only for a guest of the
  asking window) and the composer gets it as an image with the page URL. This
  is the user showing the agent something; the agent driving the page is
  section 14.

The `<webview>` is part of the DOM, so menus and modals stack over it with no
help from main. Prior art: Codex's in-app browser is a `<webview>` on a
`persist:codex-browser-app-route:` partition.

As built (S3, Codex 26.1016 measured): the side panel's + (Mod+T, Codex's Open
Browser Tab) opens a tab on Codex's new tab page (the address bar over the
tools, Changes and Terminal); the toolbar is back, forward and reload in one
capsule, the 32px address capsule, then Annotate (Mod+Shift+., Codex's
annotation mode) and Open in browser. A bare `localhost:3000` gets `http://`,
a dotted host `https://`. `window.open` from a page loads an http(s) page in
the same tab (the webview has `allowpopups` so the request reaches main, which
never opens a window). A failed load shows the error over the page. A focused
page's key presses never reach the renderer, so main matches them in
`before-input-event` against the user's own bindings (`host/keys/set`) and
hands the ones allowed over a preview (its own, the palette, sidebar, panel
and terminal toggles, new thread) back as `key` events. A link to a local
server in a message opens in the thread's preview.

### 9.9 Files and open-in

A read-only file tab (from tool rows and the changes pane) shows the file with
syntax highlighting and line numbers, read through `file/read`, at the line the
tool read or changed; the Changes pane expands unchanged lines between hunks
from `thread/diff/file`'s two sides (v1-completion-plan.md, D5). Tabs are
Codex's: per thread, Changes first, then file tabs that share the strip (240px
each, shrinking to 120px, then scrolling); a tab opened in passing is italic
and the next one replaces it, a double-click keeps it, and past 12 file tabs
the least recently used goes. Mod+Shift+W closes the active one.

"Open in…" lists what `host/openIn/list` finds, each with its program's icon,
and remembers the choice per project and overall. The targets, their order and
their lookups are Codex's (26.1016 main bundle, its `HVe` list), one for one:
VS Code, VS Code Insiders, Visual Studio, Cursor, Devin Desktop, BBEdit, Emacs,
Sublime Text, Zed, Windsurf, Antigravity, GitHub Desktop, the default app, the
file manager, Terminal, Git Bash, Cmder, WSL, iTerm2, Kitty, Ghostty, Warp,
Xcode, the eight JetBrains IDEs and TextMate, each only on the platforms Codex
has it there (no Windows Emacs or Windsurf). Windows: the PATH command, a shim
resolved to the program beside or above its `bin`, then `%LOCALAPPDATA%\Programs`,
`Program Files` and `Program Files (x86)` (newest folder first for JetBrains),
GitHub Desktop in `%LOCALAPPDATA%` itself, Visual Studio by year and edition
then `vswhere`, Windows Terminal through its app alias or Start menu shortcut,
Cmder through `%CMDER_ROOT%`. macOS: fixed `/Applications` paths (also under
`~/Applications`), app bundles by name prefix, JetBrains Toolbox's apps, `xed`
for Xcode. Linux: PATH, JetBrains Toolbox scripts, then `.desktop` entries
through `gio launch`, which takes the path alone. Each editor gets its own
go-to-line syntax (`--goto path:line:column`, `path:line:column`, `--line`,
`+line:column`, TextMate's `txmt://` URL); a terminal opens at the folder, and
on macOS and Linux a file opens in `$VISUAL`, `$EDITOR` or the first of nvim,
vim, nano and less inside the terminal, at the line (osascript for Terminal and
iTerm2, `open -na` for Kitty and Ghostty, each Linux terminal's own run flag).
One departure: Codex runs a Windows `.cmd` shim through cmd.exe with the path as
an argument, which cmd.exe would parse (`&`, `%`); here a shim stands for the
program above it or is left out. The menu ends with "Open in folder", "Open in
GitHub" when the checkout's origin is on github.com and a branch is checked out
(`git/origin`; the file at the branch and line), and "Save as…"
(`host/file/saveCopy`: the save dialog with the file's name, written whole).
Icons on Windows come from one PowerShell extraction per listing, since
Electron's `getFileIcon` gives many programs the generic icon. Detection runs
at most once a minute; vswhere and xcode-select run as child processes, so main
waits on neither (about 30-45 ms of main's time on this machine, 255 ms in all).

Status (2026-10-23): built in S2b with the handoff dialog's dry run.

### 9.10 Settings

As Codex's (measured 2026-10-19). While Settings is open the sidebar column
lists the pages under a search pill, grouped Personal and Coding; the page
fills the main area: a 28 px title in a 768 px column, then sections 40 px
apart, each a heading over cards of rows (title and description on the left,
the control on the right, 16 px-inset hairlines between rows). Mod+, opens it;
back returns.

| Page | Contents | Stored in |
| --- | --- | --- |
| General | Permissions: "Show Full access in the composer". General: Confirm before closing a window (never, close shortcut only, always; main shows a native confirmation, the close button and Alt+F4 only with "always"), Automatically archive inactive threads (never, 1–90 days; idle, unpinned threads not on screen, checked hourly). Composer: Show context window usage, Send shortcut (Enter or Mod+Enter), Follow-up behavior (Queue or Steer). Notifications: Turn completion notifications (never, only when unfocused, always; clicking one opens the thread) | desktop state |
| Appearance | Mode as three thumbnails (system, light, dark); the showing theme's customization: Theme (KnightCode or Custom) with Import and Copy theme, Accent (Codex's eight choices or a custom colour), Background, Foreground, Font (the installed fonts). Advanced: UI and code font sizes (window-wide); UI font style, content font and code font with their styles, translucent sidebar, contrast (per theme); diff markers (colour or +/−) and pointer cursors (window-wide) — section 11.3 | desktop state |
| Models & accounts | default model (the composer's searchable model list), signed-in accounts with Sign out, add an account (`account/login/*`, prompts inline) | settings.json |
| Archived threads | Delete all; search; a filter by kind (all, local, worktree) and order (updated, created, alphabetical); a filter by project (or no project); the threads grouped by project, each with Delete (confirmed) and Unarchive | — |
| Keyboard shortcuts | every binding: each combination as a chip with Change (records the next key press) and Clear, "Unassigned" when it has none, Reset when it differs from the default; search by name | desktop state |
| About | versions, logs folder | — |
| Configuration (Coding) | a scope (User config or a sidebar project, with its trust switch); the agent keys `/settings` offers: default reasoning, auto-compact and its token budgets, steering, skill commands, image resizing and blocking, transport, HTTP idle timeout, cache warming and default project trust (user only), updates, install telemetry, the Anthropic extra-usage warning; reasoning per model (user only); a link to the file. A row set in the edited file has a reset | settings.json |
| Tools (Coding) | `/tools`' KnightCode tools with their own settings (web search provider and Brave key, classifier model); the tools new threads start with (`defaultTools`); codemode mode and inline budget | tools.json, settings.json |
| MCP servers (Coding) | a scope; each server's exposure, on/off and Remove (confirmed); Add server (name, command or URL, user or project file); links to the files. Sign-in and live status stay with `/mcp` | mcp.json |
| Extensions & skills (Coding) | a scope; every extension, skill, prompt template and theme `knightcode config` lists except the built-in extensions (always on), each with a load switch | settings.json |
| Worktrees (Coding) | tabs General (branch prefix, fetch before creating, delete old worktrees, auto-delete limit; managed worktrees by project with New thread in this worktree, Delete and the threads that used each) and Environments (each project's setup scripts) | settings.json |

Approvals is not a page: its one setting is General's Permissions row.
Deviation from section 10: rebindings are kept in the desktop state, not in
`keybindings.json`.

Pages backed by settings.json write with `config/write`; Tools, MCP servers and
Extensions & skills use `tool/*`, `mcp/*` and `resource/*` (app-server.md).

### 9.11 Command palette

Mod+K or Mod+Shift+P, as Codex's command menu: a 520 px card a fifth of the
way down the window, the search field, then groups. With no query: Threads
(the nine Alt+1–9 reach, in sidebar order, each with its project and chip)
and Quick actions (New thread, Open folder, Hide or Show sidebar, Settings,
Keyboard shortcuts, each with its shortcut). With a query: matching threads,
settings pages and actions. Rows are 31 px; the selected one is lit, the
others sit at 75 %. Arrows move, Enter runs, Escape closes.

### 9.12 Onboarding and empty states

First launch:

1. "Sign in to a provider" — the `account/list` login options; each runs
   `account/login/start` and renders its prompts (URL to open, device code,
   API key field). Skippable: "I'll do this later".
2. "Open a project" — folder dialog.
3. The composer, placeholder "What should we build in <project>?".

A project with untrusted project resources shows a banner before its first
thread: "This project has its own extensions and settings. Trust it?" with
Trust and "Not now". The choice is recorded with `project/trust/set`
in the same trust store the terminal uses; until trusted, the
server loads without them (architecture.md section 5.2). Threads already
loaded in that project pick it up on their next load.

Empty states: no projects ("Open a folder to start"), no threads in a project
("No threads yet"), no changes ("No changes yet").

### 9.13 Notifications and sounds

When a turn completes in a thread the user is not looking at, the row becomes
unread from the live `thread/turn/completed` summary, and, per preference, an
OS notification "<thread>: done" or
"<thread>: failed" is shown. Approval requests always notify when the app is
unfocused (section 4.3). OS notifications fire only on live outcomes, never
on startup/reconnect reads. No sounds in v1.

Turn completion notifications are Chromium's `Notification` from the
renderer, per Settings › General.

Toasts, as Codex's: top centre under the title bar, at most three, 8 px
apart, each with a mark and a close button, gone after 5 s. Errors are red,
confirmations ("Committed …", "Copied theme") green, other notes neutral.

### 9.14 Copy

Sentence case. Status rows use present and past forms of one verb and name the
object: "Running `npm test`", "Ran `npm test` in 4.2s". Errors say what
failed and offer the next step. Destructive confirmations state the
consequence and whether it can be undone. The product calls the user's
conversations "threads" everywhere.

---

## 10. Keybindings

`apps/desktop/src/shared/keybindings.ts` holds `DESKTOP_KEYBINDINGS`, ids
under `desktop.*`, same shape as `KEYBINDINGS` (`defaultKeys`,
`description`), with `mod` meaning Ctrl on Windows and Linux and Cmd on
macOS. User overrides come from the same `keybindings.json` the terminal reads
(`keybindings.ts:344`), so one file configures both. No component checks a
key directly; every handler is registered against an id.

Defaults follow Codex's where both apps have the action. Punctuation and
digit keys match the physical key (`KeyboardEvent.code`), so the layout and
Shift do not change them. Settings › Keyboard shortcuts rebinds any id
(section 9.10).

| Id | Default |
| --- | --- |
| `desktop.palette` | mod+k, mod+shift+p |
| `desktop.settings` | mod+, |
| `desktop.shortcuts` | mod+/ |
| `desktop.nav.back` / `forward` | mod+[, alt+← / mod+], alt+→ (and the mouse's back and forward buttons) |
| `desktop.thread.new` | mod+n, mod+shift+o |
| `desktop.thread.archive` | mod+shift+a |
| `desktop.thread.rename` | mod+alt+r |
| `desktop.thread.pin` | mod+alt+p |
| `desktop.thread.copyCwd` | mod+shift+c |
| `desktop.thread.markUnread` | mod+shift+u |
| `desktop.thread.clearUnread` | shift+escape |
| `desktop.thread.find` | mod+f (View › Find; the bar searches the thread or, opening it, the Changes pane's diffs) |
| `desktop.find.next` / `previous` | enter, f3 / shift+enter, shift+f3 |
| `desktop.thread.goTo1` … `goTo9` | alt+1 … alt+9 (the Nth thread as the sidebar shows them) |
| `desktop.thread.recent1` … `recent6` | mod+alt+1 … mod+alt+6, and mod+shift+9 / mod+shift+8 for 4 and 5 (the Nth most recently updated thread) |
| `desktop.thread.next` / `previous` | mod+alt+], mod+alt+→ / mod+alt+[, mod+alt+← (the next or previous thread in sidebar order, wrapping) |
| `desktop.thread.nextAttention` | mod+alt+a (the next thread waiting on you, failed or unread) |
| `desktop.thread.copyDeeplink` | mod+alt+l |
| `desktop.thread.copyPath` | mod+alt+shift+c (the session file) |
| `desktop.thread.copyCode` | mod+shift+; (the last fenced code block in the thread's replies) |
| `desktop.thread.fork` / `openWindow` / `delete` | unassigned, as in Codex |
| `desktop.project.open` | mod+o |
| `desktop.sidebar.toggle` | mod+b, mod+shift+s |
| `desktop.panel.toggle` | mod+shift+g |
| `desktop.view.zoomIn` / `zoomOut` / `zoomReset` | mod+shift+=, mod+=, mod+num+ / mod+-, mod+num- / mod+0 |
| `desktop.view.fullScreen` | f11 |
| `desktop.app.quit` | mod+q |
| `desktop.window.close` | mod+w (File › Close Window; confirms per Settings › General) |
| `desktop.turn.interrupt` | escape |
| `desktop.composer.send` / `newline` / `steer` | enter / shift+enter / mod+enter |
| `desktop.approval.accept` / `decline` | enter / escape |

The shortcuts page lists every id, including those with no default.

---

## 11. Theming

### 11.1 Theme files

Not implemented, and no longer planned for v1: no package contributes a
theme (the `desktop` resource type is dropped, section 12). What is built is
section 11.3's customization: a background, a foreground and an accent per
theme (`renderer/appearance.ts:17-19`), mixed in RGB, travelling by Copy
theme and Import theme as `knightcode-theme-v1:` JSON of that customization.
The theme file this section first specified was:

```ts
interface DesktopTheme {
	name: string;
	appearance: "light" | "dark";
	base: { surface: string; ink: string; accent: string; contrast: number }; // contrast 0-100
	fonts?: { ui?: string; code?: string };
	overrides?: Partial<Record<TokenName, string>>;
	syntax?: string;          // a bundled syntax theme name
	terminal?: string[];      // 16 ANSI colours
}
```

Every token is derived from `base` in OKLCH: surfaces step lightness away
from `surface` by an amount scaled by `contrast`; text tiers mix `ink` toward
`surface`; accent states shift lightness. `overrides` wins over derivation.
Prior art: Codex derives its whole palette from surface, ink, accent and a
contrast number; four inputs give users a theme editor that cannot produce an
unreadable combination by accident.

The two built-in themes take `surface` and `ink` from the terminal palettes
(`dark.json`: text `#e7e2db`; `light.json` likewise). The accent is the
desktop's own orange, one family across themes: `#f97316` in dark and the
deeper `#ea580c` in light, the base its tints (focus, switch, selection) derive
from. Filled light controls use `#c2410c` (orange-700): white text on `#ea580c`
is only 3.6:1, below AA (section 16).

### 11.2 Tokens

Components use only these CSS custom properties; a lint rule rejects colour
literals in `apps/desktop/src/renderer`:

```text
--kc-bg-shell  --kc-bg-surface  --kc-bg-elevated  --kc-bg-hover  --kc-bg-selected
--kc-text  --kc-text-muted  --kc-text-faint  --kc-text-on-accent
--kc-border  --kc-border-strong  --kc-focus
--kc-accent  --kc-accent-hover  --kc-success  --kc-warning  --kc-danger
--kc-diff-add-bg  --kc-diff-add-text  --kc-diff-del-bg  --kc-diff-del-text
--kc-ansi-0 … --kc-ansi-15  --kc-terminal-bg  --kc-terminal-fg
--kc-font-ui  --kc-font-code  --kc-size-ui  --kc-size-code  --kc-radius
```

Defaults: UI 13 px, code 12 px, radius 8 px. MCP Apps receive the theme in
their `ui/initialize` host context (section 12).

### 11.3 Customization (Settings › Appearance)

Built ahead of theme files, as Codex's Appearance: per light and dark theme,
an accent, a background, a foreground and a UI font. `renderer/appearance.ts`
derives the palette from the background and foreground as 11.1 has it: each
surface steps from the background toward the foreground (or toward black) by
a fixed fraction and each text, border and ghost token is the foreground at a
fixed alpha. The fractions are fitted to the built-in tokens, so the default
colours derive the built-in palette (a test holds this); nothing is derived
until something is customized. Contrast (0–100, 60 by default) scales the
surface steps. The accent reaches every place Codex draws its own (traced in
Codex 26.1013 by switching its accent): Send and Stop, focus rings and the
selected theme card, switches and the contrast fill, the unread dot, info
icons, links and pressed toolbar toggles (a lighter shade in dark, a darker one
in light, over a 10 % tint), the user's bubble, the text selection, checked
checkboxes (native ones through `accent-color`) and the composer's drop
overlay. Menus, menu check marks, selected rows and the sidebar's running
spinner stay neutral, as Codex's do. The
built-in shades are derived from the default accent, KnightCode's orange, so
the app is orange in those places until another accent is chosen (a test
holds this too). Fonts: a family per slot (UI, content, code), and a face of it
reached through an `@font-face` alias over `local(<PostScript name>)`. Copy
theme puts `knightcode-theme-v1:{json}` on the clipboard and Import theme reads
one. The translucent sidebar asks main for the system material (acrylic on
Windows 11 22H2+, vibrancy on macOS); only when it takes does the page leave
the sidebar see-through (65 % of its colour), painting the shell around the
card with its spread shadow. It is off by default (Codex's is on). Not built:
Codex's Reduce motion override (the system setting rules) and "Separate light
and dark modes" (customizations are always per theme).

---

## 12. MCP Apps

Third-party UI in the desktop is the MCP Apps extension of MCP
(`io.modelcontextprotocol/ui`), as Codex hosts its plugins' apps. The first
draft of this section, a GUI extension SDK with a `desktop.json` package type,
a `kc-ext://` scheme and a `utilityProcess` extension host, is dropped
(v1-completion-plan.md, D1-D2). Built-in panes are native (section 2).

### 12.1 Source

- The MCP extension advertises the extension's client capability with the
  `text/html;profile=mcp-app` MIME type. A tool whose `_meta.ui.resourceUri`
  names a `ui://` resource puts `{server, resourceUri}` in its result's
  details; the app server carries it as the tool item's `mcpApp`.
- A tool whose `_meta.ui.visibility` leaves out `"model"` is callable by its
  app and not offered to the model.
- Apps come only from MCP servers the user configured; an agent extension
  cannot ship HTML (architecture.md section 8.2).

### 12.2 Hosting

- The renderer reads the HTML with `mcp/app/readResource`; main serves it at
  `kc-mcp-app://<uuid>/index.html`, a privileged standard scheme, one origin
  per app instance, with the spec's restrictive default CSP widened only by
  the resource's declared `connectDomains`, `resourceDomains`,
  `frameDomains` and `baseUriDomains` (nothing undeclared reaches the
  network).
- The frame is `sandbox="allow-scripts allow-same-origin"` with no referrer
  and no `allow` permissions, as Codex's `mcp-sandbox-element`. Its origin is
  its own, so `allow-same-origin` reaches neither `app://desktop` nor another
  app. The spec's sandbox proxy is for web hosts; a desktop host draws the
  View directly.
- An app draws inline in its tool row (48-720px high, from the app's size
  notifications) and opens full screen as a side panel tab.

### 12.3 Bridge

`renderer/mcp-app-bridge.ts` speaks the extension's JSON-RPC over
`postMessage` (MCP Apps, Stable 2026-01-26), accepting only the frame's own
window and origin, and sending nothing before the app's
`ui/notifications/initialized`: `ui/initialize` (theme and style variables,
display mode, locale, platform), tool input, result and cancellation
notifications, `ui/resource-teardown` before the frame goes, `tools/call`
through `mcp/app/callTool`, `resources/read` of the same server through
`mcp/app/readResource`, `ui/open-link` (http and https), `ui/message` (sent as
the user's message after a confirm card, as Codex confirms an app's
follow-up), size changes, and display mode requests (`inline` and
`fullscreen`). Anything else, `ui/update-model-context` included, answers
`-32601`. v1-completion-plan.md's "MCP Apps coverage" table is the full
list.

### 12.4 Approval

An app's tool call runs through the app server's gate, not the agent's: full
access runs it; Ask and Auto-edit run a tool annotated read-only and answer
`approvalRequired` for any other, which the desktop turns into a confirm card
naming the server and the tool before retrying with `confirmed`. An app
calls only its own server's tools, and only those whose `_meta.ui.visibility`
includes `"app"`.

Status (2026-10-23): built in S3. An app draws between its turn's work and the
reply, so it stays in sight when the work folds, at a position that holds while
the turn runs and after (the frame is never made again). Full screen is a side
panel tab with a fresh instance of the app (given the call's input and result),
and the inline card says it is shown there. The confirmations are Codex's:
"Send follow-up?" / "An app wants to send this prompt" for `ui/message`, and a
card naming the tool for a call that may change things. The style variables
map our tokens the way Codex's `mcp-app-host-styles` maps its own.

---

## 13. Protocol needs

What this document requires from the app server, all specified in
architecture.md section 4.6:

- `clientMessageId` on user input and echoed on `userMessage` (section 7.2);
- image input by `{path}` (sections 9.4, 9.8);
- `expectedTurnId` on steer and follow-up, `turnId` on interrupt;
- thread status with `waitingOn` and `systemError` (section 9.2);
- turn `startedAt`, `completedAt`, structured `error {message, kind}`;
  item timestamps (section 9.3);
- per-file `diff` in `fileChanges` (section 9.3);
- `thread/tokenUsage/updated` (section 9.3);
- `thinkingLevels` per model (section 9.4);
- approval `decisions`, `reason`, command `prefix`, decline `message`
  (section 9.5);
- queue entries with ids and `turn/queue/remove` (section 9.4);
- `file/search` (section 9.4);
- `config/write`, `config/read` origins and `errors` (section 9.10);
- load `warnings` in `thread/start`, `thread/resume` and `thread/fork` results, and the `warning` notification (section 8);
- `project/trust/read` and `project/trust/set` (section 9.12);
- `thread/delete` (sections 9.3, 9.10), which deletes archived threads only;
- `thread/fork` with `atItemId` and a worktree `workspace` (section 9.3), a
  fork at a turn's last item keeping the turn's end;
- `sessionFile` on a loaded thread (section 9.3, Copy conversation path);
- `server/diagnostics` (section 9.10);
- `thread/unsubscribe` status (section 4.3);
- `initialize` `platform` (section 9.9 paths, section 9.7 shells);
- `file/read`, `thread/diff/file` and `thread/handoff`'s `dryRun` (section
  9.9, the handoff dialog), `mcp/app/readResource`, `mcp/app/callTool` and the tool
  item's `mcpApp` (section 12), specified in v1-completion-plan.md section
  4.1.

---

## 14. Later phases

Specified enough here that v1 does not block them; each gets its own spec.

| Phase | Feature | Seam v1 leaves |
| --- | --- | --- |
| L1 | Pop-out tabs, quick-launch window on a global hotkey, tray | tabs are routes; `host/window/open` |
| L2 | Full-text thread search | sidebar search box; a server `thread/search` |
| L3 | Agent control of the preview (navigate, click, read DOM, screenshot) | the preview `<webview>`'s guest, reached by main through `webContents.fromId` and its `webContents.debugger`, as Codex's browser use does (architecture.md section 9) |
| L4 | Agent-to-app tools: the agent opens tabs, creates threads and worktrees, changes settings, through approval-gated tools | `host/*` methods behind a tool extension |
| L5 | Scheduled runs and recurring threads | none in v1; architecture.md section 12 excludes them until then |
| L6 | Remote hosts: SSH and WSL app servers, one connection per host | main's single client becomes one client per host; routing keys gain a host id |
| L7 | Subagent threads shown under their parent | `parentThreadId` on `Thread` |
| L8 | Code review inbox for pull requests | an MCP App, as Codex's bundled "Code Review" plugin is (section 12) |
| L9 | Voice input | composer attachment slot |
| L10 | Extension marketplace | package install; MCP servers with apps (section 12) |

Not planned: an OS sandbox for agent commands, ChatGPT-style chats without a
project, desktop pets, hardware macro pads.

---

## 15. Implementation phases and file manifest

architecture.md's server phases are A (done), A2, B (worktrees,
diffs, git), C (extension UI), D (terminal CLI). The desktop phases below
depend on them as stated.

### Phase S1 — shell, threads, composer, approvals (needs A2)

Status (2026-10-15): the S1 list is in place apart from the items below. Built: Forge + Vite +
React scaffold, the app server child with restart backoff, the router (sections 4.2-4.3), the
window port, host methods, `app://` with CSP, desktop state and preferences, the quit question,
the Codex-style title bar with inline menu and back/forward, the sidebar (pinned, needs
attention, projects, recents, search), the transcript with turn grouping, markdown and older
history, the thread menu, the composer (queue, steer, stop, `@` and `/` pickers, image
attachments by path, model, thinking and approval pickers, Full access confirmation), approval
cards, settings (General, Appearance, Models & accounts with sign-in, Approvals, Keyboard
shortcuts, About), the archive screen, the command palette, onboarding on the new-thread screen,
light and dark themes. Tests: router, state file, transcript ordering, keybindings and a
key-comparison scan, theme contrast, server restart backoff and quit deadline, preload origin
check, `app://` path rule, resume after a restart (36); section 16 is covered apart from the quit
dialog itself, which needs the end-to-end harness. Moved out of S1: tabs and the right and bottom
regions go to S2 and S3, where the changes pane, terminal and preview give them content; the
OKLCH derivation goes with user themes (S3); end-to-end tests need Playwright, a new dependency
to approve; "Open in…" (`open-in.ts`, `host/openIn/list`) goes to S2, where file tabs and the
changes pane give it a place.

- `apps/desktop/package.json`, `forge.config.ts`, `vite.*.config.ts`,
  `tsconfig.json`; root workspace entry; AGENTS.md layout row.
- `src/main/`: `index.ts` (single instance, deep links, windows),
  `server.ts` (section 5), `router.ts` (section 4.2-4.3), `host.ts`
  (section 4.4), `state.ts` (section 7.3), `protocol-scheme.ts` (`app://`),
  `menu.ts`, `open-in.ts`, `shell-env.ts`.
- `src/preload/index.ts`.
- `src/shared/host-protocol.ts`, `keybindings.ts`.
- `src/renderer/`: store, sidebar, tab workspace, thread view and item
  renderers, composer, approvals, modals for `ui/dialog`, toasts, palette,
  settings (General, Appearance, Models & accounts, Approvals, Keyboard
  shortcuts, About), onboarding, themes and tokens.
- Docs: `packages/cli/docs/desktop.md` (architecture.md section 8.3).

### Phase S2 — changes, worktrees, git (needs B)

- Changes pane, worktree composer options, handoff UI, Worktrees settings.
  Done (#395).
- Read-only file tabs, "Open in…", hunk expansion and the handoff pre-check
  moved to S2b, built there (section 9.9).

### Phases S2b, S3, S4 — planned in v1-completion-plan.md

- S2b: file tabs, "Open in…" (`src/main/open-in.ts`, `host/openIn/*`), hunk
  expansion, the handoff dry run.
- S3: the terminal (node-pty in main, xterm.js), the preview (`<webview>`),
  MCP Apps. View rendering and the extension settings pages are done (Phase
  C, S1). Built (sections 9.7, 9.8, 12).
- S4: makers, the bundled `knightcode` binary and `knightcode.version` under
  `resources/knightcode/`, signing hooks (unsigned in v1), the update feed,
  the release workflow, end-to-end tests, the memory figures.

---

## 16. Required tests

Main (`apps/desktop/test/main/`, Vitest, a fake server over the in-process
transport where possible):

- Request ids from two windows with the same client id reach the server
  distinct and come back to the right window.
- Two windows holding one thread: one server subscription; releasing one
  answers locally; releasing the last sends `thread/unsubscribe` once.
- An approval goes to exactly one window; closing that window moves it to the
  other holder and sends `serverRequest/cancelled` to neither closed window
  nor twice to anyone; with no holder left the server withdraws it.
- `thread/replaced` moves holds from the old id to the new one.
- A message from a frame whose origin is not `app://desktop` is dropped.
- Server exit: in-flight requests fail with `serverRestarted`, the respawn
  waits per the backoff (fake timers), held threads are resumed, five exits in
  two minutes stop the loop.
- Quit with an active thread asks first; the child gets stdin EOF and is
  killed only after the deadline.
- `desktop-state.json` corrupt: renamed, defaults apply; writes are atomic.
- The `app://` protocol rejects `..` and paths outside the renderer directory;
  `kc-mcp-app://` serves only an app's own HTML at `/index.html`, with the CSP
  its resource declared.
- A `<webview>` with a partition outside `persist:kc-preview:`, a `file:`
  source or a preload is refused or stripped; a capture of another window's
  guest is refused.
- Host method params failing their schema answer `invalidParams`.

Renderer (`apps/desktop/test/renderer/`, Vitest with jsdom):

- The store applied to a recorded notification stream equals the
  `thread/read` of the same thread, including an `item/completed` that moves
  an item by `index`, an `item/removed`, and a referenced running turn
  installed with buffered notifications replayed.
- An optimistic message is replaced by its echoed `userMessage`.
- The approval card offers exactly the server's `decisions`.
- Every `desktop.*` id is reachable from the palette and rebindable; no source
  file under `src/renderer` calls a key comparison outside the keybinding
  dispatcher.
- Theme derivation: every built-in theme meets WCAG AA (4.5:1) for
  `--kc-text` and 3:1 for `--kc-text-muted` on `--kc-bg-surface`.

MCP Apps:

- The bridge ignores a message from another window or origin, answers an
  unknown method with `-32601`, and retries an `approvalRequired` call with
  `confirmed` only after the user confirms; an app reaches only its own
  server's tools.

End to end (Playwright `_electron`, faux provider, Windows and Linux CI):

- Launch, sign-in skipped, open a fixture project, send a prompt, see the
  streamed reply, approve a `bash` call in Ask mode, see "Ran …", interrupt a
  second turn, archive the thread, find it in the archive.

---

## 17. Exclusions

Do not add:

- Git, file reads or settings writes in main or the renderer (they are
  protocol calls).
- Node access in any renderer, MCP App frame or preview guest.
- A GUI extension SDK, `desktop.json`, `kc-ext://` or an extension host
  process (section 12).
- A second store or cache of thread contents outside the renderer's store.
- SQLite or another native database in the desktop.
- A `knightcode` binary resolved from PATH in a packaged build.
- Hardcoded key checks or colour literals in renderer components.
- HTML or scripts from agent extensions (architecture.md section 8.2).
- Any feature of section 14 before its own spec.
- A preselected model in the desktop (the server's default or the user's
  choice decides).

---

## 18. Validation

From the repo root:

- `bun run check-types`
- `cd apps/desktop && bun run check-types` (the root check does not cover
  `apps/desktop`)
- `cd apps/desktop && bun x vitest --run`
- `cd apps/desktop && bun x playwright test` (end to end)
- `rg -n "nodeIntegration: true|contextIsolation: false|sandbox: false" apps/desktop/src`
  → no matches.
- `rg -c "#[0-9a-fA-F]{3,8}\b|rgb\(" apps/desktop/src/renderer --glob "!**/themes/**" --glob "!*.css"`
  → no TypeScript file above its count on 2026-10-23 (amended: this grep
  once required no matches, which `main` never met; the counts are listed
  in v1-completion-plan.md section 9). Colours are defined as tokens in the
  stylesheets, which may grow.
- `rg -n "child_process|spawn\(" apps/desktop/src/renderer apps/desktop/src/preload`
  → no matches.
- `rg -n "simple-git|isomorphic-git|\"git\"," apps/desktop/src` → no matches.
- `rg -n "event\.key ===|e\.key ===" apps/desktop/src/renderer` → matches only
  in the keybinding dispatcher.
- Memory: with ten threads held across three windows and one terminal per
  thread, record main, renderer and app server working sets on Windows and
  macOS; publish the figures here before v1 acceptance (S4).
- Manual, per phase, on Windows and macOS: the end-to-end flow above, a
  server kill (`taskkill /F` / `kill -9`) mid-turn and the recovery banner, a
  second window on the same thread answering an approval, keyboard-only use of
  the palette, composer and approval card.

---

## 19. Stop condition

The desktop app v1 is complete when:

- It installs and updates on Windows, installs on macOS (ad hoc signed, with
  an "Update available" banner until it is signed) and on Linux, with the
  bundled `knightcode` binary and no PATH dependency.
- Many threads across many projects run at once in one app server; the
  sidebar shows running, waiting, unread and failed threads without
  subscribing to them.
- A thread can be started local or in a worktree, prompted, steered, queued,
  interrupted, forked, archived and deleted; approvals work in all three
  modes with command-prefix allowance.
- The changes pane stages, reverts, comments, commits, pushes, opens PRs and
  hands off worktrees.
- A thread has terminals and a preview with Annotate, file tabs and "Open
  in…"; an MCP server's app draws in its tool row, calls its own tools
  through the approval gate, and opens full screen in the side panel.
- Agent extension dialogs, notifications, status, widgets and views render.
- Every requirement of architecture.md section 9 is met, the required tests
  pass, and every validation grep matches as stated.
