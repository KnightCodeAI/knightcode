---
"@knightcodeai/cli": patch
---

Fixed cancelling a shell command on macOS sometimes letting the next command in a sequence such as `a; b` start. The process group is now stopped before it is killed, which narrows the window in which a killed child can wake its shell.
