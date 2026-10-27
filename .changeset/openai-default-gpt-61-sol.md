---
"@knightcodeai/cli": patch
---

Changed the `openai` provider's default model from GPT-5.5 to GPT-6.1 Sol, matching `openai-codex`. It applies after `/login` when no model is set, as the startup fallback, and for `--provider openai`.
