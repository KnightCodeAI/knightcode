---
"@knightcodeai/cli": patch
---

Changed the JSON schemas for settings, models, keybindings and themes to be served from https://knightcode.dev/schemas/ instead of GitHub raw URLs; the bundled themes, docs and examples now use the new `$schema` address, and existing files with the old address keep validating.
