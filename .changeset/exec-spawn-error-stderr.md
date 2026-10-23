---
"@knightcodeai/cli": patch
---

Fixed `exec` from extensions swallowing the reason a command could not start. A missing binary or a bad working directory used to return an empty `stderr` with exit code 1; the spawn error message is now in `stderr`.
