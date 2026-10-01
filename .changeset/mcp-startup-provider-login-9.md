---
"@knightcodeai/cli": patch
---

Fixed extension commands registered without a string name or a handler crashing KnightCode when typing `/`. The extension now fails to load with an error instead.
