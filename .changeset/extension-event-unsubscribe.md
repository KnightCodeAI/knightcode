---
"@knightcodeai/cli": minor
---

Added unsubscribe to extension events: `knightcode.on(event, handler)` now returns a function that removes that one registration, so an extension can listen once or stop listening without reloading. Removing a handler never affects a dispatch already in progress.
