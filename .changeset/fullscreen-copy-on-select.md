---
"@knightcodeai/cli": patch
---

Add a `fullscreenCopyOnSelect` setting (default `true`). Turn it off and a
fullscreen mouse selection stays highlighted instead of being copied on mouse
release, and `Ctrl+X` copies the active selection rather than the last
assistant message.
