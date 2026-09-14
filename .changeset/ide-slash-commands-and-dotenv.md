---
"@knightcodeai/cli": patch
---

Fixed `/` listing no commands in a new, loaded, resumed or forked thread in the desktop IDE: `knightcode-engine` sent the list before the IDE had registered the session, and the IDE dropped it.
