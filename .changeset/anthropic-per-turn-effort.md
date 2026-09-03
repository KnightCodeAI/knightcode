---
"@knightcodeai/cli": minor
---

Added per-turn thinking effort preservation for Claude models. Each response's provider effort level is now persisted and replayed as effort-only system messages on later requests, so a conversation keeps the effort each turn was actually answered at instead of collapsing to the current setting. Eligible OpenRouter Claude models now route through the native Anthropic Messages API rather than the OpenAI-completions shim, and dropped thinking blocks surface as transcript diagnostics when `showCacheMissNotices` is enabled.
