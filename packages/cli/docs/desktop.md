# Desktop App

The KnightCode desktop app is an Electron window over the [app server](app-server.md). It
runs one `knightcode app-server` process and every window talks to it, so the desktop and
the terminal share sessions, settings, credentials and extensions. The agent's
configuration lives in the files the terminal reads (`settings.json`, `mcp.json` and
`tools.json`); the app's Settings edit those same files, so a change made in either place
shows in both.

Download it from [knightcode.dev](https://knightcode.dev) or from the GitHub releases tagged
`desktop-v<version>`.

## Installing

Each installer carries its own `knightcode` binary as the app server, so nothing needs to be
on `PATH`. None is signed by a recognised publisher yet:

- Windows: run `KnightCode-<version>.Setup.exe`. It installs for your user only, into
  `%LOCALAPPDATA%\KnightCodeDesktop`, with Start menu and desktop shortcuts; remove it from
  Settings › Apps. SmartScreen says "Windows protected your PC" the first time: choose
  More info, then Run anyway.
- macOS: open the `.dmg` for your Mac (`arm64` for Apple silicon, `x64` for Intel) and drag
  KnightCode to Applications. The app is signed ad hoc, not notarized, so the first launch
  is refused: open System Settings › Privacy & Security and choose Open Anyway, or run
  `xattr -dr com.apple.quarantine /Applications/KnightCode.app` once.
- Linux: install the `.deb` (`sudo apt install ./knightcode-desktop_<version>_amd64.deb`) or
  the `.rpm` (`sudo dnf install ./knightcode-desktop-<version>-1.x86_64.rpm`).

Check a download against the release's `SHA256SUMS`.

## Updates

- Windows: the app checks at launch and every 4 hours, and downloads a newer version in
  the background. An Update button then shows at the right of the title bar, and Settings ›
  About offers Restart to update; if threads are running it asks first, since quitting
  interrupts them. Help › Check for Updates… checks now.
- macOS: the app checks the same way and shows Update when a newer version exists, which
  opens the release page to download it (it cannot install itself while it is signed ad
  hoc). KnightCode › Check for Updates… checks now.
- Linux: install the newer `.deb` or `.rpm` over the old one.

Settings › About shows the app's and the app server's versions and when the app last
checked.

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
on Windows, `~/Library/Logs/KnightCode` on macOS, `~/.config/KnightCode/logs` on Linux). At
5 MiB it moves to `app-server.log.1`, the older ones to `.2` up to `.4`, so at most five files
are kept. Settings › About › Show logs opens the folder.

To build the installers for this machine, stage the app server and make them; the
installers land in `apps/desktop/out/make/`:

```sh
bun run apps/desktop/scripts/stage-server.ts   # builds knightcode for this platform
cd apps/desktop && bun run make
```

The end-to-end tests launch the production build that packaging leaves in
`apps/desktop/.vite/`, against an app server whose model is scripted
(`packages/cli/test/fixtures/faux-app-server.ts`): from `apps/desktop`, run
`bun run package`, then `bun run test:e2e`.

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
    `mcp.json` or a trusted project's `.knightcode/mcp.json`, as `/mcp` and `knightcode mcp`
    do. Signing in to a
    server and its live status stay with `/mcp` in a thread.
  - Extensions & skills: load or skip each extension, skill, prompt template and theme you
    added, as `knightcode config` does. Built-in extensions are always on and not listed.
  - Plugins: install, trust, turn on or off, update and uninstall [plugins](plugins.md), and
    add marketplaces and install from their catalogs, as `knightcode plugin` does. A plugin
    is trusted only after a confirmation that lists what it runs. Its MCP servers' sign-in
    and status stay with `/mcp` in a thread.

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
- Background terminals: a command KnightCode starts in the background (see
  [Background commands](usage.md#background-commands)) shows in the transcript as "Started
  background terminal with …" while it runs, and as stopped or ran once it ends. When it
  ends, the notice KnightCode was given shows as "Background terminal finished with …", or
  "Background terminal stopped with …" for one that was stopped, opening to the end of its
  output and how it ended: the exit code when there is one, else why it failed or that it
  timed out. The thread's summary lists the running ones under Background processes: click
  one to follow its output in a side panel tab, or hover it and press Stop. A command you
  stop is recorded for KnightCode without starting it again.
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
`"desktop"` and `ctx.hasUI` is `true`). What they show appears in the app:

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
