---
"@knightcodeai/cli": patch
---

Fixed `knightcode.exec()` in extensions buffering unlimited output: a command that kept writing could exhaust memory. Output is now capped by a new `maxBuffer` option (default 256 MiB); past it the command is terminated and the result has `truncated: true`. A command that ignores SIGTERM is now actually force-killed after 5 seconds, and the call returns even when a child process keeps the output pipes open.
