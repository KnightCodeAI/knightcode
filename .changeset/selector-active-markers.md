---
"@knightcodeai/cli": patch
---

Changed the selectors in `/thinking`, `/model`, `/scoped-models`, `/trust` and per-model thinking settings to keep the active option marked while browsing, by moving the marker into a fixed column ahead of the label. `/scoped-models` now uses the same per-item toggle as the rest, strikes through models that are no longer available, and no longer collapses to a single model when the first one is toggled off.
