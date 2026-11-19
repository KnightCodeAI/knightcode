---
"@knightcodeai/cli": patch
---

Fixed an external SIGTSTP (`kill -TSTP`) suspending KnightCode without restoring the terminal. It now suspends the same way Ctrl+Z does.
