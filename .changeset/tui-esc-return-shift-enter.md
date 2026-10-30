---
"@knightcodeai/cli": patch
---

Fixed Shift+Enter in Apple Terminal setups that send `ESC` + Return being read as Alt+Enter, which queued a follow-up message instead of inserting a new line. With Shift held, `ESC` + Return is now treated as Shift+Enter (also on native Windows); without Shift it stays Alt+Enter.
