---
"@knightcodeai/cli": patch
---

Fixed processes killed by a signal reporting success; they now map to a 128 + signal exit code.
