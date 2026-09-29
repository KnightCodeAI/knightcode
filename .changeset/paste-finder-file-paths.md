---
"@knightcodeai/cli": patch
---

Fixed pasting files copied in the macOS Finder inserting their icon instead of their paths. Copied files now paste as their original paths, and a failed clipboard paste shows an error instead of failing silently.
