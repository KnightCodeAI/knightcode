---
"@knightcodeai/cli": patch
---

Fixed extensions failing to import `@knightcode/ai/models`. The extension loader and the embedded module map now include that subpath, so `clampThinkingLevel` and the other model helpers resolve.
