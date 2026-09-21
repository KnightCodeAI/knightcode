---
"@knightcodeai/cli": patch
---

Fixed session files with an invalid session id in their header opening normally. Extensions build directory paths from that id, so such a file is now refused with the same error as an invalid `--session-id`.
