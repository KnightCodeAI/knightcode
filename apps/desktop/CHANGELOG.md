# @knightcode/desktop

## 0.1.0

The first release of the KnightCode desktop app. It runs the same agent as the terminal, so threads, settings, sign-ins and extensions are shared between the two. The installers are not signed by a recognised publisher yet, so Windows SmartScreen and macOS Gatekeeper ask once before the first launch: see the [install notes](https://knightcode.dev/docs/run/desktop).

### Added

- Added projects and threads: add folders to the sidebar, pin threads, and open any saved thread, including one started in the terminal. A thread still open in a terminal session can be forked instead. Threads can be renamed, forked, compacted, copied and archived, and the archive can be searched.
- Added the composer: send a message to queue after the running turn or steer the turn instead, find files with `@`, list commands, prompt templates and skills with `/`, and paste images. Each thread has its own model and thinking level.
- Added approval modes: Ask for approval, Auto-edit and Full access. An approval card allows once with Enter and denies with Escape, optionally telling KnightCode why.
- Added plan review: a submitted plan asks whether to implement it in the thread, implement it in a new thread with only the plan, keep planning, or exit planning.
- Added the Changes panel: the thread's diff with expandable context and review comments, read-only file tabs at the line a tool read or changed, and Open in, which sends a file to an editor, terminal or IDE on your machine.
- Added worktrees and git: start a thread in a new worktree, commit and push, create or switch branches, open a pull request, and hand a thread's changes between a worktree and the local checkout.
- Added terminals in the thread's folder with the shells found on your machine, and background terminals: commands KnightCode runs in the background list under Background processes in the thread's summary, each with its live output in a side panel tab and a Stop control.
- Added preview tabs for http and https pages, each thread with its own storage, and Annotate, which attaches part of a page to the message you are writing.
- Added MCP Apps: a tool's app shows in the thread, calls its own server's tools after asking you, and opens full screen in the side panel.
- Added extension UI: dialogs, questions, notices, status chips, widgets and declarative views from extensions show in the app.
- Added Settings that edit the terminal's own files: send key, queue or steer, theme, default model, provider sign-in and keyboard shortcuts, and under Coding the agent's configuration, tools, MCP servers, and extensions and skills.
- Added updates: Windows downloads a newer version in the background and offers Restart to update; macOS shows Update and opens the release page.
- Added the command palette (Ctrl+K), System, Light and Dark themes, and a game of chess on the home screen's knight mark.
