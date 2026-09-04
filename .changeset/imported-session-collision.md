---
"@knightcodeai/cli": patch
---

Fixed importing a session file silently overwriting a stored session that happened to have the same filename. The import is now written alongside it under a numbered name.
