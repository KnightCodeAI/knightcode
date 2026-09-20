---
"@knightcodeai/cli": patch
---

Fixed automatic compaction doing nothing when the newest tool result alone exceeds the retained-token budget. The cut now falls back to the assistant message that made the tool call, so older history is summarized before the next request instead of the session overflowing.
