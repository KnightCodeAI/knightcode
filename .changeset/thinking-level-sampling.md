---
"@knightcodeai/cli": patch
---

Added per-thinking-level sampling parameters for OpenAI-compatible models. `samplingParamsByThinkingLevel` in `models.json` overrides the model's `samplingParams` for the active thinking level, and a request can still override either.
