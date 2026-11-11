---
"@knightcodeai/cli": patch
---

Fixed find patterns that start with `./`, which matched nothing; the leading `./` is now ignored.
