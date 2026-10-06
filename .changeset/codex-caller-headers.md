---
"@knightcodeai/cli": patch
---

Fixed Codex requests ignoring a caller's `originator` and `User-Agent` headers. Those headers now replace the defaults. Authorization and the ChatGPT account id stay fixed.
