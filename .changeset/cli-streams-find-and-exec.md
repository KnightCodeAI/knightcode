---
"@knightcodeai/cli": patch
---

Fixed extension commands terminated by a signal, which now report 128 plus the signal number instead of success.
