---
"@knightcodeai/cli": patch
---

Fixed the terminal staying in mouse, focus, bracketed-paste, Kitty-keyboard, and alternate-screen modes when the process exits without stopping the UI. A process exit handler writes those resets when `stop()` did not run.
