---
"@knightcodeai/cli": patch
---

Tidy the tool call transcript block. The dark theme's `green` and `red` now hold
the pinned diff hexes, so the success bullet, `✓` marks, bash mode and markdown
code blocks match the diff colours instead of staying olive. Shell tool call
headers are clamped to a single line — a long command no longer wraps several
rows of quoted URL over the transcript — and the bash expand hint follows its
output rather than preceding it, matching every other tool renderer. Line
counts in the expand hints are pluralised.
