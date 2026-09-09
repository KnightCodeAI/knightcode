---
"@knightcodeai/cli": patch
---

Fixed OpenCode and OpenCode Go requests dropping the `x-opencode-session` routing header; every API adapter now maps `sessionId` onto it while leaving an explicit caller override alone.
