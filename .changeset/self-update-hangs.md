---
"@knightcodeai/cli": patch
---

Fixed `knightcode update` for npm and pnpm installs hanging forever on a stalled package manager, failing on Windows while another KnightCode session held a native file, and reporting success when the installed binary was missing or still old.
