---
"@knightcodeai/cli": patch
---

Fixed the model, scoped-model, and thinking selectors hardcoding Ctrl+S to save; the shortcut is now the `app.models.save` and `app.thinking.save` keybindings and the on-screen hint follows a rebind.
