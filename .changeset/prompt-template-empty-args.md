---
"@knightcodeai/cli": patch
---

Fixed empty quoted prompt-template arguments. `""` and `''` stay in place, so later arguments are not shifted and positional defaults still apply.
