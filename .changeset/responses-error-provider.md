---
"@knightcodeai/cli": patch
---

Fixed errors from OpenAI-compatible providers on the Responses API always being labelled as OpenAI errors: the message now names the provider that actually failed.
