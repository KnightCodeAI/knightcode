---
"@knightcodeai/cli": patch
---

Fixed `before_agent_start` not firing for runs started by `knightcode.sendMessage(..., { triggerTurn: true })`, which let the system prompt change mid-run and broke the provider prompt cache. `BeforeAgentStartEvent` is now a union on `messageType` (`"user"` or `"custom"`), and the session counts as busy from the start of run setup, so messages sent meanwhile join the starting run.
