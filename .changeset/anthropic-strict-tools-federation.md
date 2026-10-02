---
"@knightcodeai/cli": patch
---

Fixed Anthropic requests failing when a tool schema uses keywords Anthropic strict tool use rejects, such as `minimum` and `maximum`. Such tools are now sent non-strict.
