---
"@knightcodeai/cli": patch
---

Fixed Ctrl+Break on Windows ending KnightCode without restoring the terminal. It now shuts down like SIGTERM and leaves the alternate screen, mouse reporting and keyboard modes.
