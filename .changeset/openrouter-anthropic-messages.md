---
"@knightcodeai/cli": minor
---

Added native Anthropic Messages routing for Claude models on OpenRouter, which previously went through the OpenAI-completions shim. The shim cannot express per-turn thinking effort, so those models could not preserve it.
