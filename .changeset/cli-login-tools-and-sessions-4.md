---
"@knightcodeai/cli": patch
---

Fixed file search on Windows. A pattern that uses backslashes matches the same paths as one that uses slashes, and a cancelled search does not start `fd`.
