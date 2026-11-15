---
"@knightcodeai/cli": patch
---

Fixed tool calls whose strict schema has a node without a type, by dropping strict mode for that call instead of failing the request.
