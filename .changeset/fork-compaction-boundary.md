---
"@knightcodeai/cli": patch
---

Fixed forking a compacted session losing the messages after the compaction boundary when that boundary pointed at a label. Labels are dropped from the forked path, which left the boundary pointing at an entry that no longer existed.
