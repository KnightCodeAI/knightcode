---
"@knightcodeai/cli": patch
---

Fixed thinking being dropped on replay for OpenRouter's `~anthropic/claude-*-latest` aliases: they used Chat Completions, which loses the thinking signature. They now use Anthropic Messages with adaptive thinking, like the versioned Claude models.
