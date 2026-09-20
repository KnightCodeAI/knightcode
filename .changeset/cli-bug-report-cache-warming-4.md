---
"@knightcodeai/cli": patch
---

Changed extension loading to pull in its transform dependencies only when an extension actually needs transforming, which shortens startup for everyone who has no extensions installed.
