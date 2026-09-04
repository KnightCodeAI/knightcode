---
"@knightcodeai/cli": patch
---

Added a `vllmPriority` compat flag for custom `openai-completions` providers. Set it on a model and requests carry a top-level `priority` field, which a vLLM server running with `--scheduling-policy priority` uses to order work; lower values are served first. Unset by default, so nothing changes for providers that do not want it.
