---
"@knightcodeai/cli": patch
---

Fixed Responses requests that resent the tool list after a tool change and dropped the prompt cache. Models that accept additional tools now declare every tool in place, and a removal is announced in text so a later update can restate which tools are still unavailable.
