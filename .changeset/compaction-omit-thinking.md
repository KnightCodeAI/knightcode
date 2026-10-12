---
"@knightcodeai/cli": patch
---

Changed compaction, branch summaries and bug reports to leave thinking blocks out of the conversation they serialize; replayed thinking is often not part of the live context, so including it could make a summarization request larger than the context it summarizes and fail on every attempt.
