---
"@knightcodeai/cli": patch
---

Fixed a bare URL that runs into a multi-megabyte line exhausting memory in terminals with OSC 8 hyperlinks; URLs longer than 8192 characters are no longer linked.
