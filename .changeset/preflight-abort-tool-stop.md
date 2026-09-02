---
"@knightcodeai/cli": patch
---

Stop already-prepared tool calls from running when a parallel batch is aborted
during preflight, so cancelling at a permission prompt no longer lets the
remaining tools in that batch execute.
