---
"@knightcodeai/cli": patch
---

Fixed the full-output file of a truncated `!` bash command sometimes being empty when read straight away: the command now finishes writing that file before its result, and the file's path, are returned.
