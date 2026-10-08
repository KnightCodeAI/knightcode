---
"@knightcodeai/cli": patch
---

Fixed the input cursor stretching across edge cells in terminals that extend cell colors into the window padding; with `showHardwareCursor` enabled, only the terminal cursor is drawn.
