---
"@knightcodeai/cli": patch
---

Fixed a shell command killed by a signal (an OOM kill, `kill -9`, a `SIGTERM`) being reported to the model as a success. It now fails with the conventional exit code (137 for `SIGKILL`, 143 for `SIGTERM`) and keeps the output it produced before dying.
