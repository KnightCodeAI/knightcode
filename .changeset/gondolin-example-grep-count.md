---
"@knightcodeai/cli": patch
---

Fixed the Gondolin example's grep tool reporting a wrong match count when context lines were requested. It now returns the number of matches it found, as the built-in grep does, so the tool row no longer counts context lines, or the "No matches found" line, as matches.
