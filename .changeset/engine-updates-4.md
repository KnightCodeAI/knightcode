---
"@knightcodeai/cli": patch
---

Fixed the Unix socket transport leaving a second socket entry beside every published route, and removing that route before its private bind path during shutdown.
