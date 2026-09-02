---
"@knightcodeai/cli": patch
---

Resolve relative paths in `read`, `write`, `edit`, `grep`, `find`, `ls` and the
shell tool against the calling context's cwd when one is supplied, so a
subagent or extension running in a different directory no longer resolves
against the session cwd.
