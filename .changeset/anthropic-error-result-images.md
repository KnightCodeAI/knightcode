---
"@knightcodeai/cli": patch
---

Fixed Anthropic requests failing when a tool returned an error result that contained an image; the image is now replaced with a short text note.
