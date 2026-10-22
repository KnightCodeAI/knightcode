---
"@knightcodeai/cli": minor
---

Added declarative views for extensions: `ctx.ui.setWidget(key, view)` and `details.view` on tool results and extension messages, drawn in the terminal and by app server clients, which also receive extension status, titles, working messages and widgets, and send widget button and field events back through `ctx.ui.onViewEvent`.
