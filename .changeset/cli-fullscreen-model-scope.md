---
"@knightcodeai/cli": patch
---

Fixed the startup `Model scope: …` notice staying in the shell after a fullscreen session exited (above the resume hint, with `fullscreenExitOutput: "resume-hint"`). Fullscreen now shows the notice in its header; regular mode prints it before the session starts, as before.
