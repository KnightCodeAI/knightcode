---
"@knightcodeai/cli": patch
---

Fixed Mistral tool calls that could stay silent for minutes when a tool asked for strict JSON. Strict sampling is sent only when the model sets `compat.supportsStrictMode`.
