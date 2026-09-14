---
"@knightcodeai/cli": patch
---

Fixed API keys in a project's `.env` showing up in the desktop IDE as signed-in providers that signing out could not remove: `knightcode-engine` no longer reads a `.env` or `bunfig.toml` from the directory the IDE was launched in.
