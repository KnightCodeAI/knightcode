---
"@knightcodeai/cli": patch
---

Fixed a missing or invalid `--mode` value being silently ignored; KnightCode now reports the valid values and exits with a nonzero status.
