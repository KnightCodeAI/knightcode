---
"@knightcodeai/cli": patch
---

Changed codemode to cost far fewer prompt tokens and to say how to recover from errors. The `codemode` description lists the script globals in one line each and points to the new Codemode docs page; reading a tool or `models` member that does not exist names the close matches, so scripts that probed with `typeof tools.name` must use `"name" in tools`.
