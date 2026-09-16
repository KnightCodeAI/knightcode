---
"@knightcodeai/cli": patch
---

Fixed Baseten requests to carry session-affinity headers so a conversation keeps hitting the same replica and benefits from automatic prompt caching.
