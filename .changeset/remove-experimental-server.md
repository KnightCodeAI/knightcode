---
"@knightcodeai/cli": minor
---

Removed the experimental `knightcode server` and `knightcode client` commands (behind `KNIGHTCODE_EXPERIMENTAL=1`), their plugin and session-worker processes, and the `KNIGHTCODE_SERVER_DIR`, `KNIGHTCODE_SERVER_ID` and `KNIGHTCODE_RADIUS_GATEWAY` variables; the Radius gateway override only served the removed Radius relay.
