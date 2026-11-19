---
"@knightcodeai/cli": patch
---

Fixed the terminal sometimes printing mouse, focus or key reports as text after quitting. KnightCode now waits for its terminal reset sequences to reach the terminal (for up to a second) before it exits.
