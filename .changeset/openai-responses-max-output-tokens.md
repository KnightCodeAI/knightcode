---
"@knightcodeai/cli": patch
---

Add a `supportsMaxOutputTokens` compat flag for `openai-responses` models
(default `true`). Set it to `false` for a gateway that rejects
`max_output_tokens` and the parameter is omitted instead of failing the
request.
