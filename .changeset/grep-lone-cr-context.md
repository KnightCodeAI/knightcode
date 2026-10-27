---
"@knightcodeai/cli": patch
---

Fixed `grep` with `context` misnumbering lines in a file that contains a lone carriage return. Context lines now count lines the same way ripgrep does, so the match and the lines around it are the right ones.
