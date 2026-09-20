---
"@knightcodeai/cli": patch
---

Fixed fuzzy search in the model, session and file pickers lagging on long lists; matching now skips ahead with a native substring search and returns the same results in the same order.
