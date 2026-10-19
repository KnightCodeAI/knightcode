---
"@knightcodeai/cli": patch
---

Fixed Windows shell checks so a runnable Microsoft Store alias is accepted. Node's existsSync rejects those aliases, so shell lookup now uses access.
