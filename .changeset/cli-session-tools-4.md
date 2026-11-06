---
"@knightcodeai/cli": patch
---

Changed session shutdown so dispose waits for an OAuth token refresh that has already started to finish saving before the process exits.
