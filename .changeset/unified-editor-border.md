---
"@knightcodeai/cli": minor
---

Changed the prompt input border to use the theme's `border` color at every thinking level; the footer still shows
the level and shell input keeps its `bashMode` color. The `thinking*` theme colors are no longer used.
Breaking change: `Theme.getThinkingBorderColor(level)` is removed; extensions must use `Theme.getEditorBorderColor()`.
