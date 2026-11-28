---
"@knightcodeai/cli": patch
---

Fixed `!!` command output counting toward the context token estimate even though it is never sent to the model.
