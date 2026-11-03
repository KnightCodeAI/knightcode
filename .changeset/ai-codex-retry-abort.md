---
"@knightcodeai/cli": patch
---

Fixed Codex retries so a finished retry drops its abort listener and a later abort cannot cancel the completed stream.
