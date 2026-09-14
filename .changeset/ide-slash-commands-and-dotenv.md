---
"@knightcodeai/cli": patch
---

Fixed the desktop IDE's `knightcode-engine` integration:

- `/` now lists commands in a new, loaded, resumed or forked thread; the list was sent before the IDE had registered the session and was dropped.
- Signing in or out, or a model catalog change, now refreshes the model choices of every open thread.
- The engine no longer reads a `.env` or `bunfig.toml` from the directory the IDE was launched in, so API keys in a project's `.env` no longer show up as signed-in providers that signing out cannot remove.
