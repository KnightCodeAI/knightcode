---
"@knightcodeai/cli": minor
---

Added extension changelogs. After an extension package updates, the next fresh launch shows the top changes from its new `CHANGELOG.md` entries under "Extension updates", the same way KnightCode shows its own. Packages can point `knightcode.changelogPath` at another file inside the package, or set it to `""` to opt out; `collapseChangelog` condenses the section to one line per package.
