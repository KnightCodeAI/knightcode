---
"@knightcodeai/cli": patch
---

Fixed `~` in resource setting patterns such as `!~/skills/pdf`, `+~/x` and `-~/x` never matching, because it was compared literally instead of expanded to the home directory.
