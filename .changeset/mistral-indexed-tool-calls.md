---
"@knightcodeai/cli": patch
---

Merge Mistral streaming tool-call chunks by their `index`, so a call whose id
and name arrive only in the first chunk is no longer split into two tool
calls with truncated arguments.
