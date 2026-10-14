---
"@knightcodeai/cli": patch
---

Fixed the provider chosen for a model reference depending on catalog order. `--model`, `--models`, `/model` and credential printing now share one resolver: credentials decide between providers that offer the same model, an ambiguous match is reported instead of falling through to a fuzzy match, and a `:<thinking>` suffix no longer changes the provider. A `--models` entry offered by several providers is added for each, with a warning.
