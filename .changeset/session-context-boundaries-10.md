---
"@knightcodeai/cli": patch
---

Fixed text files that begin with `GIF` being treated as images and left out of `read` and `@file` input. Detection now requires the full GIF87a or GIF89a signature.
