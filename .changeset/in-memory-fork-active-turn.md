---
"@knightcodeai/cli": patch
---

Settle the running turn before an in-memory `/fork`, so the aborted assistant
message and its tool results are no longer appended to the freshly forked
session.
