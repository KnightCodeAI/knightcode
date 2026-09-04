---
"@knightcodeai/cli": patch
---

Fixed the built-in tools ignoring the working directory supplied on the extension context. `read`, `write`, `edit`, `ls`, `find`, `grep` and the shell tool resolved relative paths against the directory captured when the tool was created, so a caller running a tool against a different directory operated in the session's directory instead of its own.
