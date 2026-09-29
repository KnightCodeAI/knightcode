---
"@knightcodeai/cli": minor
---

Added virtual models: an extension can register a selectable model, with `registerVirtualModel`, that routes each request to a physical model and thinking level. Virtual models appear in `/model`, `--model` and scoped models, the footer shows the routed model, and assistant messages record the thinking level the agent loop requested. See `docs/virtual-models.md`.
