---
"@knightcodeai/cli": patch
---

Fixed display math wider than the terminal breaking apart, with rows of the equation shifting out of line. It now falls back to the raw LaTeX source, which wraps like normal text.
