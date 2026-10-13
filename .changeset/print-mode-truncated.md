---
"@knightcodeai/cli": patch
---

Fixed print mode succeeding silently when the response stopped at the model's output token limit: it still prints the partial text, and now also warns on stderr and exits 1.
