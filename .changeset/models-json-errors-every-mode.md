---
"@knightcodeai/cli": patch
---

Fixed print, JSON and RPC modes not reporting an invalid `models.json`, so a typo showed up only as "Model not found" or "No API key found"; every mode and SDK runtimes now report it as a warning, including interactive mode, which showed it as an error.
