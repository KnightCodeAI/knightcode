---
"@knightcodeai/cli": patch
---

Fixed a bare `400` or `413` with no body from any provider being treated as a context overflow and triggering compaction. Only Cerebras reports overflow that way, so the rule now applies to Cerebras alone.
