---
"@knightcodeai/cli": patch
---

Fixed closing a Windows console window or terminal tab so KnightCode runs session shutdown and stops commands the shell started before it exits. Quitting while a `!` command is still running, or ending RPC mode while a bash command is still running, also waits for those processes to stop.
