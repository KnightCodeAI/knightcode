---
"@knightcodeai/cli": patch
---

Fixed prompt submission slowing down with session length, because resolving the session's model selection looked up the model catalog once per assistant message, and model lookups slowing down for providers with a refreshed remote catalog.
