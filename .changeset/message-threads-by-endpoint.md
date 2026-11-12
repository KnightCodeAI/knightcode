---
"@knightcodeai/cli": patch
---

Fixed Anthropic message threads so they are on by default for any model served from api.anthropic.com, whatever provider name it is configured under, and stay off for other endpoints unless `compat.supportsMessageThreads` turns them on. Claude subscription requests also report a current Claude Code version.
