# Desktop App

The KnightCode desktop app is an Electron window over the [app server](app-server.md). It
runs one `knightcode app-server` process and every window talks to it, so the desktop and
the terminal share sessions, settings, credentials and extensions. Nothing about the agent
is configured in the app itself: models, approval defaults and extensions come from your
`settings.json`, the same file the terminal reads.

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
  in to and out of providers, keyboard shortcuts, versions and logs.
- Archived threads: search, unarchive, or delete for good.
- Command palette (Ctrl+K): actions and threads in one search.
- Quitting while threads run asks first.

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
| Send | Enter |
| New line | Shift+Enter |
| Steer the running turn | Ctrl+Enter |
| Stop the running turn | Escape (empty composer) |
| Allow / deny an approval | Enter / Escape (card focused) |

On macOS, Ctrl is Cmd. Settings › Keyboard shortcuts lists every binding.
