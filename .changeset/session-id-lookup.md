---
"@knightcodeai/cli": patch
---

Fixed resuming a session by its exact ID reading every transcript in the session directory first, which made startup slow in directories with long histories.
