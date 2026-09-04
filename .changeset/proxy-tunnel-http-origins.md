---
"@knightcodeai/cli": patch
---

Fixed proxied plain-HTTP provider requests hanging after a tool call by tunneling them with CONNECT again, restoring the behaviour Undici changed in 8.7.
