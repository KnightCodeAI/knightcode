---
"@knightcodeai/cli": minor
---

Added aspect ratio and size options for image generation. `models.generateImages(model, { input }, { aspectRatio, size })` in `codemode` passes them to OpenRouter, and option keys other than these two throw instead of being dropped.
