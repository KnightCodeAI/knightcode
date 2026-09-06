---
"@knightcodeai/cli": patch
---

Fixed compiled binaries shipping without the TUI's native helpers, which left clipboard reads on the command-line fallbacks and dropped Shift+Tab on Windows. Each target's prebuilds are now copied next to the executable.
