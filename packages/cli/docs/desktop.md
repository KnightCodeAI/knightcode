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
installed `knightcode`); `app-server` is appended. A packaged build ignores it and runs only
its bundled binary.

Server output goes to `app-server.log` in the app's logs folder (`%APPDATA%\KnightCode\logs`
on Windows, `~/Library/Logs/KnightCode` on macOS, `~/.config/KnightCode/logs` on Linux).

## What works

- Projects: add folders to the sidebar; their threads list under them. Threads from other
  folders appear under Recent. The project list is desktop-only state in
  `desktop-state.json`; removing a project leaves its threads on disk.
- Threads: open any saved thread, including ones started in the terminal. A thread open in
  a terminal session is locked there; the app says so instead of opening it twice.
- Composer: Enter sends, Shift+Enter adds a line. While a turn runs, Send queues the
  message to start its own turn when this one ends; Ctrl+Enter (Cmd+Enter on macOS) steers
  the running turn instead. Queued messages can be removed until they start. Escape on an
  empty composer stops the turn.
- Model and thinking level per thread, from the models you are signed in to. A new thread
  uses your default model.
- Approval modes: Ask, Auto-edit and Full access. In Ask mode a request shows a card with
  the decisions the server offers; Enter allows once, Escape denies.

## Keyboard shortcuts

| Action | Default |
| --- | --- |
| New thread | Ctrl+N |
| Add a project folder | Ctrl+O |
| Send | Enter |
| New line | Shift+Enter |
| Steer the running turn | Ctrl+Enter |
| Stop the running turn | Escape (empty composer) |
| Allow / deny an approval | Enter / Escape (card focused) |

On macOS, Ctrl is Cmd.
