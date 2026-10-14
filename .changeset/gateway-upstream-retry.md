---
"@knightcodeai/cli": patch
---

Fixed gateway errors reading "Unable to forward upstream stream" failing the turn. They are now retried like other transient provider errors.
