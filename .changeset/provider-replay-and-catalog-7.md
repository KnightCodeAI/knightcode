---
"@knightcodeai/cli": patch
---

Fixed Amazon Bedrock thinking replay so models that accept block binding drop stale thinking blocks, and Claude Opus 4.6 and Sonnet 4.6 are not sent the field they reject.
