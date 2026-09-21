---
"@knightcodeai/cli": patch
---

Fixed image-only prompts being rejected by some OpenAI-compatible providers, which refused the empty text part sent alongside the image.
