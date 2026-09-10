---
"@knightcodeai/cli": patch
---

Added `compaction.modelOverrides`, per-model `reserveTokens` and `keepRecentTokens` budgets keyed by exact `"provider/modelId"`, so a million-token model can hold a large response reserve without inflating it for every other model. Each field falls back independently to the ordinary setting and then the built-in default, and the resolved values drive manual compaction, threshold checks, overflow recovery, and the `session_before_compact` payload.
