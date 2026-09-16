---
"@knightcodeai/cli": minor
---

Fixed a `user_bash` handler that throws or returns a malformed result silently falling back to the local shell — the command is now reported as failed instead of running somewhere the extension meant to prevent. A handler must return `undefined`, exactly one of `{ operations }` or `{ result }`, and nothing else.
