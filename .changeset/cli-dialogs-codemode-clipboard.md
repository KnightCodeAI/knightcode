---
"@knightcodeai/cli": patch
---

Fixed a second extension dialog replacing the one on screen and leaving the first dialog's promise pending. Select, confirm, input, editor, and inline custom dialogs now stack, and closing the visible dialog shows the previous one again.
