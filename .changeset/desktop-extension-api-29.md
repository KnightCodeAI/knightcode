---
"@knightcodeai/cli": patch
---

Fixed a hung desktop extension backend so disable, revoke, and turning the preview off still dispose it, and require an app-server restart when in-process work cannot be stopped.
