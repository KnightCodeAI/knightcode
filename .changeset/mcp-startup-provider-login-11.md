---
"@knightcodeai/cli": patch
---

Changed `/reload` to enable tools newly added to the `defaultTools` setting. Tools removed from it stay enabled, tools turned off during the session stay off unless newly added, and `--tools`, `--no-tools` and `--no-builtin-tools` still override the setting.
