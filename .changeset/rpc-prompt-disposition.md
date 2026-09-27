---
"@knightcodeai/cli": patch
---

Added the prompt's disposition to RPC `prompt` and `follow_up` responses, so a client can tell whether the prompt started a run, was queued, or was consumed by an extension.
