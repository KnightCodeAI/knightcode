# Desktop App

The KnightCode desktop app is an Electron window over the [app server](app-server.md). It
runs one `knightcode app-server` process and every window talks to it, so the desktop and
the terminal share sessions, settings, credentials and extensions. The agent's
configuration lives in the files the terminal reads (`settings.json`, `mcp.json` and
`tools.json`); the app's Settings edit those same files, so a change made in either place
shows in both.

The app is in development and not yet published. Phase S1 (threads, transcript, composer,
approvals) is usable from a source checkout.

## Running from source

```sh
bun install
cd apps/desktop
bun run start
```

In a source checkout the app starts the server with `bun packages/cli/src/bun/cli.ts
app-server`. Set `KNIGHTCODE_DESKTOP_SERVER` to run a different command (for example an
installed `knightcode`); `app-server` is appended. The value is split on whitespace with no
quoting, so a path containing spaces (`C:\Program Files\...`) cannot be named; put its folder
on `PATH` and give the bare name. A packaged build ignores it and runs only its bundled binary.

Server output goes to `app-server.log` in the app's logs folder (`%APPDATA%\KnightCode\logs`
on Windows, `~/Library/Logs/KnightCode` on macOS, `~/.config/KnightCode/logs` on Linux).

## What works

- Projects: add folders to the sidebar; their threads list under them. Threads from other
  folders appear under Recents. Pin threads to keep them at the top. The project list and
  pins are desktop-only state in `desktop-state.json`; removing a project leaves its threads
  on disk.
- Threads: open any saved thread, including ones started in the terminal. A thread open in
  a terminal session is locked there; the app says so and offers to fork it. The thread
  menu renames, pins, forks, compacts, copies the transcript, and archives. Long threads
  load older messages on request.
- Composer: Enter sends, Shift+Enter adds a line (or the reverse, in Settings). While a turn
  runs, Send queues the message to start its own turn when this one ends, and Ctrl+Enter
  (Cmd+Enter on macOS) steers the running turn instead; Settings can swap the two. Queued
  messages can be removed until they start. Escape on an empty composer stops the turn.
  `@` finds files in the project, `/` lists commands, prompt templates and skills, and
  images can be pasted or added from the `+` menu.
- Model and thinking level per thread, from the models you are signed in to. A new thread
  uses your default model, which Settings can change for the terminal too.
- Approval modes: Ask for approval, Auto-edit and Full access. In Ask mode a request shows
  a card with the decisions the server offers; Enter allows once, Escape denies, and Deny
  can tell KnightCode why. Full access asks once per thread, and Settings can hide it.
- Settings: send key, queue or steer, theme (System, Light, Dark), default model, signing
  in to and out of providers, keyboard shortcuts, versions and logs. Under Coding:
  - Configuration: the agent's `settings.json` keys `/settings` offers (reasoning, compaction,
    steering, images, transport and timeouts, cache warming, project trust, updates), and
    per-model reasoning, for the user or for one trusted project. A row set in the file being
    edited has a reset button. Keys without a row are one click away in the file.
  - Tools: the KnightCode tools `/tools` manages (web fetch, web search with its provider and
    Brave key, ask user, scratchpad, classifier gate with its model), the tools new threads
    start with (`defaultTools`), and codemode.
  - MCP servers: add, remove, turn on or off and set the exposure of the servers in the user's
    or a trusted project's `mcp.json`, as `/mcp` and `knightcode mcp` do. Signing in to a
    server and its live status stay with `/mcp` in a thread.
  - Extensions & skills: load or skip each extension, skill, prompt template and theme you
    added, as `knightcode config` does. Built-in extensions are always on and not listed.

  Changes apply to threads that start or resume afterwards.
- Side panel: Changes shows the thread's diff; the separators between hunks expand to
  the unchanged lines around them. A file named in a tool row or in Changes opens in a
  read-only tab beside it, at the line the tool read or changed. A tab opened in passing
  is italic and the next one replaces it; double-click it to keep it. Each thread keeps
  its own tabs, at most 12 files.
- Open in: a file tab's Open button sends the file, at its line, to an editor, terminal
  or IDE found on your machine, or to the system's default app or file manager. The app
  remembers the last choice, per project and overall.
- Terminal: Ctrl+\` opens a terminal in the thread's folder, in a region under the chat and
  the side panel; Ctrl+J shows or hides it, and its top edge resizes it. The + menu offers
  the shells found (PowerShell, Windows PowerShell, Command Prompt, Git Bash and WSL on
  Windows; your login shell elsewhere), and the last one picked is the default. Terminals
  belong to their thread: they keep running when the window reloads or another thread
  opens, and end when you close them, archive or delete the thread, or quit. Copy needs a
  selection (Ctrl+C, Ctrl+Shift+C or Ctrl+Insert); paste with Ctrl+V, Ctrl+Shift+V or
  Shift+Insert (on macOS, Cmd+C and Cmd+V). Links in the output open in your browser.
- Preview: the side panel's + (Ctrl+T) opens a page in a preview tab, http and https only
  (`localhost:3000` is enough). A link to a local server in a message opens there too.
  Each thread keeps its own cookies and storage, cleared when the thread is deleted; pages
  get no permissions, and downloads ask where to save. Annotate (Ctrl+Shift+.) lets you
  drag over part of the page to attach it to the message you are writing, with the page's
  address.
- MCP Apps: a tool from an [MCP server](mcp.md#mcp-apps) that has an app shows it in the
  thread, under the turn's work. The app can call its own server's tools (asking you
  first for one that may change things), send a follow-up message once you confirm it,
  and open full screen in the side panel.
- Archived threads: search, unarchive, or delete for good.
- Command palette (Ctrl+K): actions and threads in one search.
- Quitting while threads run asks first.

## Extensions

Extensions load in desktop threads as they do in the terminal (`ctx.mode` is
`"desktop"`). What they show appears in the app:

- Dialogs (`select`, `confirm`, `input`, `editor`) and `ask_user`'s questions take
  the composer's place; notices (`notify`) show as toasts.
- Statuses (`setStatus`) are chips in the thread's header, with the full text on
  hover.
- `setTitle` names the window while the thread is open; the thread's own name stays.
- `setWorkingMessage` replaces the "Thinking" text while a turn waits on the model,
  and `setWorkingVisible(false)` hides it.
- Widgets (`setWidget`) show in a panel above the composer, lines in a monospace
  font, at most 10 per widget. A widget can be a
  [declarative view](declarative-views.md) whose buttons and fields work: a press
  reaches the extension's `ctx.ui.onViewEvent` handler.
- A tool result or an extension message with a view in `details.view` shows the view
  in its row.

Terminal-only UI does not draw: widget factories, `custom()` components, header
and footer components, raw terminal input, the working indicator and editor access
(`setEditorText`, `getEditorText`, `pasteToEditor`, custom editors and autocomplete).
The app server notes each such call once per thread in `app-server.log`. A widget or
status the server refuses (an invalid view, too large, too many) shows a warning
once. The protocol side is in [app-server.md](app-server.md#dialogs-and-extension-ui).

## Keyboard shortcuts

| Action | Default |
| --- | --- |
| Command palette | Ctrl+K, Ctrl+Shift+P |
| New thread | Ctrl+N |
| Add a project folder | Ctrl+O |
| Settings | Ctrl+, |
| Toggle the sidebar | Ctrl+B |
| Back / forward | Alt+Left / Alt+Right |
| Archive the thread | Ctrl+Shift+A |
| Close the side panel's file tab | Ctrl+Shift+W |
| Open a terminal / show or hide them | Ctrl+\` / Ctrl+J |
| Next / previous terminal | Ctrl+PageDown / Ctrl+PageUp |
| Open a preview / focus its address bar | Ctrl+T / Ctrl+L |
| Annotate the preview | Ctrl+Shift+. |
| Send | Enter |
| New line | Shift+Enter |
| Steer the running turn | Ctrl+Enter |
| Stop the running turn | Escape (empty composer) |
| Allow / deny an approval | Enter / Escape (card focused) |

On macOS, Ctrl is Cmd, except in Ctrl+\` and Ctrl+PageDown/PageUp, which stay Control.
Settings › Keyboard shortcuts lists every binding.
