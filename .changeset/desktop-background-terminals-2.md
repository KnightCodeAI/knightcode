---
"knightcode": minor
---

Added `thread/backgroundShells/list`, `thread/backgroundShells/output` and `thread/backgroundShells/stop` to the app server, with the `thread/backgroundShells/updated` notification: a client can list a thread's background commands, read the end of their output and stop them. A shell call whose command went on in the background carries `backgroundShellId`, and a `background_shell` message carries its notices.
