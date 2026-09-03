---
"@knightcodeai/cli": patch
---

Fixed Codex responses ending with an error when the final streamed event arrived without its trailing blank line, which dropped the reply text.
