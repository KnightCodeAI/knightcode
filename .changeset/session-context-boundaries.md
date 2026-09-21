---
"@knightcodeai/cli": patch
---

Added append-only context edits and actionable turn boundaries for extensions. A `context_edit` entry omits or replaces an earlier message in future model requests without changing raw history, usage or exports, and `turn_end` plus the new `agent_before_settle` event can append entries and ask for one more provider request. See `docs/extensions.md` and `docs/session-format.md`.
