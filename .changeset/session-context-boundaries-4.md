---
"@knightcodeai/cli": patch
---

Fixed abandoned attempts staying in the model's context after an error retry or a length/overflow recovery. The retried request now omits them; the raw transcript, exports and usage totals still show them.
