---
"@knightcodeai/cli": patch
---

Changed Kimi Coding to Chat Completions at `api.kimi.com/coding/v1`. K3, K3-256K, and Kimi For Coding keep tools loaded mid-conversation in later system messages, so the prompt cache holds. Highspeed still puts added tools in the top-level list because it rejects tool-bearing system messages.
