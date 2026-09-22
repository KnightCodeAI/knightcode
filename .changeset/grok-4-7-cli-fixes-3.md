---
"@knightcodeai/cli": patch
---

Fixed split-turn compaction summaries being refused by Claude Fable 5.1. The summarization request now separates the conversation from the instructions and asks for a continuation checkpoint instead of a prefix summary.
