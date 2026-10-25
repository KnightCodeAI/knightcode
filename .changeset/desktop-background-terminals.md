---
"@knightcodeai/cli": minor
---

Added background terminals to the desktop app: the thread's summary lists running background commands under Background processes, each opening its live output in a side panel tab and stopping on hover, and the transcript shows how each command stands and the notice of its end in place of the raw `<task-notification>` text. The app server gains `thread/backgroundShells/list`, `thread/backgroundShells/output`, `thread/backgroundShells/stop` and the `thread/backgroundShells/updated` notification.
