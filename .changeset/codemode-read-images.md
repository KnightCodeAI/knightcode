---
"@knightcodeai/cli": patch
---

Fixed codemode scripts not receiving images from `read`: `tools.read()` now resolves to an image block for image files, which `image()` shows.
