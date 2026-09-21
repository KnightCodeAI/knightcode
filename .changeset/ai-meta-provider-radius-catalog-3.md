---
"@knightcodeai/cli": patch
---

Fixed sessions on z.ai stopping instead of compacting when the provider answers a too-long prompt with its `1261` error body rather than the usual wording.
