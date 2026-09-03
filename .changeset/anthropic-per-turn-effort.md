---
"@knightcodeai/cli": minor
---

Added per-turn thinking effort preservation for Claude models. Each response's provider effort level is now persisted and replayed as an effort-only system message on later requests, so a conversation keeps the effort each turn was actually answered at instead of collapsing to the current setting. This ends a failure where a mixed-effort conversation could return 400 for the rest of the session, because the signed thinking prefix no longer matched the request.
