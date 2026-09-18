---
"@knightcodeai/cli": minor
---

Added what the desktop IDE's first run needs to `knightcode-engine`:

- `PUT /v1/models/default` records the model you pick in the IDE as your default, the same setting `/model` writes in the CLI, so both use one choice.
- `GET` and `PUT /v1/settings/telemetry` read and change the install-telemetry setting the CLI already has, so the IDE asks once and both follow the answer. The switch refuses to move while `KNIGHTCODE_TELEMETRY` is set in the environment.
- When the IDE starts the engine, it sends the same anonymous install ping as the CLI, once per IDE version, and not at all if you turned install telemetry off.
