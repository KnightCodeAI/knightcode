---
"@knightcodeai/cli": patch
---

Fixed the external editor (`Ctrl+G`) failing silently. When the editor cannot be launched or exits with an error, a status message now says so and the prompt is left unchanged. Clipboard copies and browser launches also start from the filesystem root, so they work under WSL when the working directory's `\\wsl.localhost\...` path is too long for Windows programs.
