---
"@knightcodeai/cli": patch
---

Fixed a local copy reporting success when no clipboard backend actually took the text: the terminal-escape fallback now only counts in a remote session, where it is the terminal that owns the clipboard.
