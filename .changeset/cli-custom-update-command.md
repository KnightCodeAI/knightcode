---
"@knightcodeai/cli": patch
---

Added `KNIGHTCODE_SELF_UPDATE_COMMAND` and the `selfUpdateCommand` setting, so `knightcode update` can update an installation that a wrapper or another package manager provides (mise, Nix), which it previously refused with "cannot self-update this installation". The command runs only when a newer release exists (or with `--force`), with `{packageName}`, `{version}` and `{installSpec}` filled from that release, and `knightcode update` warns when `knightcode --version` on `PATH` does not report the new version afterwards. The setting is read from user-level settings only, and while a command is configured, automatic updates only show the update notice.
