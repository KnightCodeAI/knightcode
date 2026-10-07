---
"@knightcodeai/cli": patch
---

Fixed Anthropic login when port 53692 is already taken, by binding a free loopback port and using that redirect URL.
