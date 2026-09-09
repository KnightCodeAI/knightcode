---
"@knightcodeai/cli": patch
---

Added Ctrl+D as a reliable alternative to Ctrl+S for saving the default model and thinking level. Many terminals (including Windows Terminal) swallow Ctrl+S as XON/XOFF flow control, so the keystroke never reached the app and the default was never saved. Ctrl+S still works where the terminal delivers it.
