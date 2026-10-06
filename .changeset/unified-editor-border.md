---
"@knightcodeai/cli": patch
---

Changed the prompt input border to use the theme's `border` color at every thinking level; the footer still shows
the level and shell input keeps its `bashMode` color. The `thinking*` theme colors are no longer used, and extensions
should call `getEditorBorderColor()` instead of `getThinkingBorderColor(level)`.
