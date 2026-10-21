---
"@knightcodeai/cli": patch
---

Fixed a resumed session failing every request after a response was cut off mid tool call: recovery dropped the truncated tool call but kept its tool result, and providers reject a tool result without its call. Both are now omitted together.
