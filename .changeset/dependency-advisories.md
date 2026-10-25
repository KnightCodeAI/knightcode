---
"@knightcodeai/cli": patch
---

Security Updated undici to 8.12.3, so a malicious server can no longer crash KnightCode or exhaust its memory through the responses it sends, and moved zod, body-parser and fast-uri to releases that fix their published advisories.
