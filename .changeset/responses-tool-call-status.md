---
"@knightcodeai/cli": patch
---

Fixed replay of OpenAI Responses tool calls so a function call or a custom tool call is sent again with status completed. After the Codex connection closes, GPT-6.2 was dropping the reasoning that followed those calls, because the resent history no longer matched the calls the API had stored.
