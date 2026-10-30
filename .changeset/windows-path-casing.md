---
"@knightcodeai/cli": patch
---

Fixed paths that differ only by letter case being treated as different locations on Windows. A project trust decision saved as `C:\Work\app` now applies to `c:\work\app`, the user `~/.agents/skills` folder is recognized when `HOME` uses different casing, and duplicate resources, the current session in `/resume`, and `~` shortening in displayed paths now ignore case on Windows.
