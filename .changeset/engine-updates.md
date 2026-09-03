---
"@knightcodeai/cli": patch
---

Added a `vllmPriority` compat flag for openai-completions models, sending vLLM's top-level `priority` scheduler field so background work can be kept from stalling interactive sessions.
