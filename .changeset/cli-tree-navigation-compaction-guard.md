---
"@knightcodeai/cli": patch
---

Fixed session tree navigation starting while a compaction or another navigation was still running; it now rejects instead of moving the active leaf.
