---
"@knightcodeai/cli": patch
---

Fixed a `before_agent_start` handler that returns `systemPrompt` (or sets `forceSystemPrompt`) not actually replacing the prompt on models that accept mid-conversation system messages: they kept the original prompt at the head and received the forced text as a later update. The forced prompt is now sent as the leading system prompt for the run, and the session transcript keeps recording the structured sections instead of the forced text.
