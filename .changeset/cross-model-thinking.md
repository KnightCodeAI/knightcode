---
"@knightcodeai/cli": patch
---

Fixed thinking from a previous model being replayed as visible text after switching models. Thinking from another model is now dropped: its signatures and encrypted reasoning only work with the model that produced them, and readable thinking sent as plain text made the new model treat it as part of its own reply.
