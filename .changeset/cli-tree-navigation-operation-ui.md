---
"@knightcodeai/cli": patch
---

Fixed a rejected `/tree` navigation replacing the running operation's escape handler and status spinner; the compaction or summarization it collided with now keeps its own UI.
