---
"@knightcodeai/cli": patch
---

Fixed GitHub Copilot Claude Fable models being served through the OpenAI completions adapter, which dropped the selected reasoning level. They now route through the Anthropic Messages adapter like the other Claude 4.x and 5.x models on that provider.
