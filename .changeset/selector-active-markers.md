---
"@knightcodeai/cli": patch
---

Mark the active entry with a leading `✓` column in the model, thinking-level,
scoped-models and trust selectors, so the current choice stays visible while
the cursor moves. Unavailable scoped models are struck through, and toggling a
model while every model is enabled now disables just that one instead of
collapsing the scope to it.
