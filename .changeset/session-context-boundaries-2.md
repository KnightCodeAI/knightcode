---
"@knightcodeai/cli": patch
---

Changed the session file to be the source of model context. SDK code that assigned `session.agent.state.messages` to restore history no longer affects the next request: restore with `SessionManager.inMemory(cwd, { id }, entries)` or move with `session.navigateTree()`. Extensions that switch exhaustively must handle the `context_edit` entry and the `agent_before_settle` event, `turn_end` events now carry the persisted entry ids, and runs started from an `agent_settled` handler wait until every settled handler has finished.
