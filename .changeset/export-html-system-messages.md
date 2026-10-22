---
"@knightcodeai/cli": patch
---

Fixed the HTML export ignoring the system messages stored in a session. The first system message on a branch now renders as the system prompt and tool list, and later ones as updates that name the changed prompt sections and the tools added or removed. `knightcode --export` now shows the prompt and tools as well; sessions without system messages still fall back to the exporting agent's current prompt and tools.
