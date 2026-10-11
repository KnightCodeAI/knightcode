---
"@knightcodeai/cli": patch
---

Fixed macOS 27 killing KnightCode at launch with `SIGKILL (Code Signature Invalid)`: the macOS binaries are now re-signed after compiling.
