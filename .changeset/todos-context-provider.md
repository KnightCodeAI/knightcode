---
"@knightcodeai/cli": patch
---

Re-inject the current todo list after each tool round so the model's plan stays in context during long turns. Only fires when the list has unfinished items and has changed since the last round.
