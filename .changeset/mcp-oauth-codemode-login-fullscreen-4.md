---
"@knightcodeai/cli": patch
---

Fixed memory retained per rendered message in the transcript: user messages keep one copy of each rendered line instead of two, and markdown, text and box components flatten their cached lines. A long assistant message keeps about a fifth of the heap it kept before.
