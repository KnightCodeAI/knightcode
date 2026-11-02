---
"@knightcodeai/cli": patch
---

Fixed AgentRouter GPT-5.6 Sol, GPT-6 Astra, and GPT-6.1 Sol requests using Chat Completions instead of the required Responses API, including when model generation falls back to the committed catalog.
