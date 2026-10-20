---
"@knightcodeai/cli": patch
---

Fixed Ctrl+Z on macOS and Linux suspending a clipboard helper along with KnightCode. The helper now leaves KnightCode's process group, so a suspend signal sent to the group does not stop it.
