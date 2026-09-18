---
"@knightcodeai/cli": patch
---

Fixed Vercel AI Gateway conversations losing their thinking on the next turn. The gateway returns thinking without a signature for models it translates, and those blocks are now replayed instead of being stripped.
