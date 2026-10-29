---
"@knightcodeai/cli": patch
---

Fixed the terminal's program status (for example the working indicator in iTerm2 3.7.5+) disappearing right after a run started in regular mode. KnightCode no longer writes OSC 133 shell-prompt markers to the terminal there; fullscreen already stripped them.
