---
"@knightcodeai/cli": patch
---

Fixed the `reload-runtime` example extension's `reload_runtime` tool never reloading: it queued `/reload-runtime` as a follow-up, which reaches the model as plain text instead of running the command. The tool now ends the run and the extension sends the command once the agent has settled, as a command.
