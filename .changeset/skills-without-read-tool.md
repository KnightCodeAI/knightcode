---
"@knightcodeai/cli": patch
---

Keep skills in the system prompt when `read` is disabled but a shell tool is
available, and tell the model to load `SKILL.md` with `bash` (or PowerShell)
instead. Skills previously vanished entirely from bash-only tool setups.
