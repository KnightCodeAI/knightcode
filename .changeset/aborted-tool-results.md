---
"@knightcodeai/cli": patch
---

Fixed an aborted batch of tool calls leaving later calls without a result. Each call now records that the operation was aborted.
