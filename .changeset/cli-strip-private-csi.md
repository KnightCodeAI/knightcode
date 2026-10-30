---
"@knightcodeai/cli": patch
---

Fixed tool output keeping the parameters of private-parameter escape sequences, such as `35;59;1M` from a mouse report (`ESC[<35;59;1M`). They are now stripped whole, while the digits after `ESC=` and `ESC>` keypad-mode sequences stay.
