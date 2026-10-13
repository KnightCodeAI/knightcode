---
"@knightcodeai/cli": patch
---

Fixed tool-call arguments losing fields when a string contained an invalid `\u` escape such as `\usepackage`; the text is now kept literally.
