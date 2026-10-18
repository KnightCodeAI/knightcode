---
"@knightcodeai/cli": patch
---

Fixed the `codemode` tool failing with `ModuleNotFound` in the standalone binaries, and image resizing in those binaries silently running on the main thread instead of in its worker.
