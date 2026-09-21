---
"@knightcodeai/cli": patch
---

Fixed custom OpenAI-compatible endpoints receiving strict tool schemas they may reject. Built-in models that support strict tools keep them, and a custom model can opt back in with `compat.supportsStrictMode: true`.
