---
"@knightcodeai/cli": minor
---

Added `/undo`: pick an earlier user message and go back to it, with the option to restore every file the abandoned turns edited. Files are backed up before each `edit` and `write`, so the restore needs no git; `/tree` and double-Escape offer the same restore. `KNIGHTCODE_DISABLE_FILE_CHECKPOINTS=1` turns the backups off.
