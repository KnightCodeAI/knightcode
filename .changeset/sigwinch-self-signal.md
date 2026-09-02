---
"@knightcodeai/cli": patch
---

Ignore a failing SIGWINCH self-signal at terminal startup, so sandboxes whose
seccomp or LSM policy denies `kill(2)` no longer crash on launch. The
dimension refresh is skipped instead.
