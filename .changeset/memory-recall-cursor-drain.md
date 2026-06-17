---
"@knightcodeai/cli": patch
---

### Added

Memory follow-ups: feed recent tool usage into the recall selector as an extra relevance signal, frame extraction's "new messages" window from a per-session cursor (so durable facts mentioned during gate-skipped turns are still reconsidered), and drain any in-flight memory extraction on `/exit` (bounded) so a save isn't dropped at shutdown.

### Fixed

`Tab` mode cycle so it reaches `AUTO`: previously `Tab` only toggled between `BUILD` and `PLAN`, making `AUTO` selectable solely via the `/agents` dialog. `Tab` now cycles `BUILD → PLAN → AUTO → BUILD`.

### Removed

Drop two unused dependencies from `@knightcodeai/cli`: `pretty-ms` (never imported) and `hono` (the toast provider's `useMemo` now imports from `react` instead of `hono/jsx`).
