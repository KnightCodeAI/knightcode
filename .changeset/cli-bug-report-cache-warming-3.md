---
"@knightcodeai/cli": patch
---

Fixed compaction cancellation: aborting during auto-compaction could leave the turn retrying, run an extension handler after the abort, or report a cancelled compaction as a failure.
