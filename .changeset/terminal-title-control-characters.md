---
"@knightcodeai/cli": patch
---

Fixed a session name containing a BEL or ESC character ending the terminal title sequence early and sending the rest of the name to the terminal as escape sequences. Control characters in the title are now replaced with spaces.
