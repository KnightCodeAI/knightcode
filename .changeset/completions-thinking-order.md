---
"@knightcodeai/cli": patch
---

Fixed thinking being stored after the answer text when a proxy such as LiteLLM sends reasoning and content in the same OpenAI-compatible stream chunk. The message now keeps the order the model produced.
