---
"@knightcodeai/cli": patch
---

Fixed resumed sessions dropping tools activated during the session. Resume now restores the session's active tools, with `--tools +name`/`-name` entries applied to them, unless `--tools` with tool names, `--no-tools`, or `--no-builtin-tools` selects tools explicitly.
