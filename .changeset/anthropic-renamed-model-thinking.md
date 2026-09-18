---
"@knightcodeai/cli": patch
---

Fixed thinking blocks being dropped on the next turn when an Anthropic-compatible endpoint reports a different model name than the one requested. The requested model stays on the message, and the reported one is kept separately for cost attribution.
