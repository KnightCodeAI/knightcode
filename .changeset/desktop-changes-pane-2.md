---
"@knightcodeai/cli": patch
---

Fixed files created or rewritten by the `write` tool reporting no diff to app server clients, so their edit summaries showed +0 -0.
