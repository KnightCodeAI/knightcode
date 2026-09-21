---
"@knightcodeai/cli": patch
---

Fixed Cerebras requests failing with a 400 when extensions declare both strict and non-strict tools; strict tool schemas are no longer sent to Cerebras.
