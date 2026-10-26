---
"@knightcodeai/cli": patch
---

Added GPT-6.1 Terra to the `openai`, `azure` and `openai-codex` providers: $1 input, $0.05 cached input, $1.25 cache writes and $5 output per million tokens, with long-context pricing above 272K input tokens, tool search, additional tools and mid-conversation effort changes. It supports thinking off but not minimal. The `openai-codex` provider serves it with a 500K context window.
