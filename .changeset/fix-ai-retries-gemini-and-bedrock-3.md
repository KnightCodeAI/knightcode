---
"@knightcodeai/cli": patch
---

Fixed OpenAI Decisions usage so cache reads and writes are reported. They stay priced at the input rate, so the cost does not change.
