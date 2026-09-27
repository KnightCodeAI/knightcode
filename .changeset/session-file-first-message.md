---
"@knightcodeai/cli": patch
---

Fixed new sessions not being written to disk until the first assistant reply; the session file is now saved at the first user message.
