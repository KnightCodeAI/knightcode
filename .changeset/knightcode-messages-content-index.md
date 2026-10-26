---
"@knightcodeai/cli": patch
---

Fixed `knightcode-messages` streams accepting any `contentIndex` from the server. An index that is not the next block (for a start event) or an existing block (for any other event) now ends the response with an error instead of growing a sparse content array or writing through `__proto__`.
