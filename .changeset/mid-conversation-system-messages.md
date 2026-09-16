---
"@knightcodeai/cli": minor
---

Changed the system prompt and tool set to live in the transcript instead of being rewritten behind it. A session records when its instructions changed or tools became available, resuming or moving between branches restores that state, and providers that support it keep their cached prompt prefix across the change. Extensions can replace individual prompt sections through `systemPromptOptions.sections`, and the deferred-tool loading path is replaced by mid-conversation tool additions on the models that accept them.
