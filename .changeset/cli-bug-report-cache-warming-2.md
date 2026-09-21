---
"@knightcodeai/cli": patch
---

Added prompt cache warming, which keeps a provider's prompt cache alive between turns where the model's cache lifetime is known, with `/settings` controls and a footer indicator. Extensions can observe or override each refresh.
