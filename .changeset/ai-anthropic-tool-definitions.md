---
"@knightcodeai/cli": patch
---

Fixed non-strict Anthropic tool schemas so root `$defs` and `definitions` stay in place and property references still resolve.
