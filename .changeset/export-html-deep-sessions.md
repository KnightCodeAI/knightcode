---
"@knightcodeai/cli": patch
---

Fixed the HTML export of a very long session failing with "Maximum call stack size exceeded". The session tree is now walked iteratively, so its depth no longer depends on the JavaScript call stack.
