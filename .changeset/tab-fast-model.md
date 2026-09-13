---
"@knightcodeai/cli": patch
---

Made Tab predictions in the desktop IDE arrive while you type.

- `knightcode-engine`'s model catalog now names a fast model for the provider you chose, and the IDE uses it for Tab: grok-4.3 for xAI, Claude Haiku 4.5 for Anthropic, qwen3-coder-flash for OpenRouter. Other providers keep your own model.
- `/v1/completions` shows the model your code with the cursor marked in place, instead of separate prefix and suffix sections that models repeated back, and strips code fences from the answer.
