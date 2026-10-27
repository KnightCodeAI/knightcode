---
"@knightcodeai/cli": patch
---

Fixed Amazon Bedrock requests failing when tools with `strict: "prefer"` exceed Bedrock's strict tool limits. The request is retried once with those tools non-strict, as the Anthropic provider already does.
