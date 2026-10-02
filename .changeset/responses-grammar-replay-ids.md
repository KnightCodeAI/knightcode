---
"@knightcodeai/cli": patch
---

Fixed switching to another OpenAI Responses model after a codemode call failing with an invalid item id. A replayed grammar tool call now drops any id that does not match its item type, since `custom_tool_call` ids must start with `ctc_` and `function_call` ids with `fc_`.
