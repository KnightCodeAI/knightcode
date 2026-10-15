---
"@knightcodeai/cli": patch
---

Changed Kimi Coding to use Chat Completions at https://api.kimi.com/coding/v1, the protocol the official Kimi Code client uses. K3, K3-256K and Kimi For Coding accept tools declared in later system messages, so tools loaded mid-conversation keep the prompt cache. Kimi Code Highspeed rejects tool-bearing system messages and keeps added tools in the top-level list.
