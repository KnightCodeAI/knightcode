---
"@knightcodeai/cli": patch
---

Fixed inline image resize under node --watch. Node's own worker messages are ignored, so a picture is no longer dropped as too large.
