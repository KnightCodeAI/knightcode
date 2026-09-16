---
"@knightcodeai/cli": patch
---

Changed the internal eval package to measure documentation lift as a paired comparison: each documentation case now runs once with the documentation section in the system prompt and once without, and the runner reports the difference. Development tooling only; the released CLI is unchanged.
