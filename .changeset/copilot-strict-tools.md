---
"@knightcodeai/cli": patch
---

Fixed GitHub Copilot GPT, Grok and MAI-Code models filling optional tool arguments with empty strings or invented values. Their tools now carry an explicit strict flag, and Copilot's Claude models use strict tools the way direct Anthropic models do.
