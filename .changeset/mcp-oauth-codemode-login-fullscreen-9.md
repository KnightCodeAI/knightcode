---
"@knightcodeai/cli": patch
---

Added `models.generateImages()` to codemode scripts. It runs image models such as OpenRouter's with the session's credentials and returns image blocks that `image()` attaches to the result; usage counts toward the session cost. Extensions can call `ctx.modelRegistry.generateImages()`.
