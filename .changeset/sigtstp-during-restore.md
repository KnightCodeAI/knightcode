---
"@knightcodeai/cli": patch
---

Fixed a suspend signal during terminal restore stopping KnightCode with the terminal only partly reset. The suspend listener stays until the restore finishes, and it is not installed before the terminal starts.
