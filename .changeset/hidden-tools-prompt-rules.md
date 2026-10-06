---
"@knightcodeai/cli": patch
---

Fixed system prompt rules and the skills hint naming tools hidden by `prepareLoadout`. Hidden tools are left out of the rules, the skills hint names no tool when the file reader is hidden, and `codemode` shows each tool's prompt guidelines with its declaration; `ToolLoadout` gains `getPromptGuidelines()`.
