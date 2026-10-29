---
"@knightcodeai/cli": patch
---

Fixed PageUp and PageDown (`tui.select.pageUp` / `tui.select.pageDown`) being ignored by most scrolling lists: autocomplete, `/settings`, the model, scoped-model, login, undo, fork and `/mcp` pickers, the llama.cpp model search and the background tasks list now page their selection. In fullscreen these keys used to scroll the transcript instead; a focused list now receives them. A remapped page key also pages an open autocomplete menu before triggering an app action.
