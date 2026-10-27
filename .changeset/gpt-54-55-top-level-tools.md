---
"@knightcodeai/cli": patch
---

Fixed switching to GPT-5.4 or GPT-5.5 on `openai`, OpenCode or GitHub Copilot after another model's tool calls, which failed with a 400 error. Those models now get their tools declared up front instead of through tool search or additional tools; mid-conversation system messages still work.
