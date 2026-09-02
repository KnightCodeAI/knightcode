---
"@knightcodeai/cli": patch
---

Run the auto-compaction threshold check between turns of an agent run, so a
tool batch that fills the context window is compacted before the next
assistant request instead of overflowing it.
