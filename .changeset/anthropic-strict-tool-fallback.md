---
"@knightcodeai/cli": patch
---

Fixed Anthropic tools marked `strict: "prefer"` failing when the provider rejects the strict tool set for grammar size, tool count, or union limits; the request is now retried once with those tools non-strict, and `strict: "require"` tools stay strict.
