---
"@knightcodeai/cli": minor
---

Added background terminals. The `bash` and `powershell` tools take `run_in_background`, so the agent can start a dev server, watcher, or long build and keep working; it is told how the command ended, with the end of its output, and continues from there. Press Ctrl+B to move a running command to the background without restarting it, see running commands in a row above the footer, and run `/tasks` to watch their output or stop them. The new `task_stop` tool is on whenever a shell tool is. Background commands end with the session; print and JSON modes wait for them before exiting.
