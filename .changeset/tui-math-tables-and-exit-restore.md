---
"@knightcodeai/cli": patch
---

Fixed Markdown tables disappearing after an unclosed display-math opener. An unclosed `$$` or `\[` no longer pairs across a table or stays pending over it, so the table renders.
