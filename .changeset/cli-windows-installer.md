---
"@knightcodeai/cli": patch
---

Added a Windows installer. `powershell -c "irm https://knightcode.dev/install.ps1 | iex"` installs KnightCode the same way `install.sh` does on macOS and Linux: a managed install pinned by the published lockfile that updates with `knightcode update`. It offers to install Node.js and Git Bash when they are missing, and running it again reinstalls or uninstalls.
