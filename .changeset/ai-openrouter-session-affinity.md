---
"@knightcodeai/cli": patch
---

Changed OpenRouter requests to send the `x-session-id` affinity header by default on both Chat Completions and Anthropic-compatible models, so cached prompts keep hitting the same upstream replica; setting `sendSessionAffinityHeaders: false` or disabling prompt caching still opts out.
