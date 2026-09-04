---
"@knightcodeai/cli": patch
---

Refreshed the generated model catalog from models.dev. GitHub Copilot drops eight models that the provider no longer serves (`claude-opus-4.5`, `claude-opus-4.6`, `claude-sonnet-4`, `claude-sonnet-4.5`, `gemini-3.1-pro-preview`, `gpt-4.1`, `gpt-5.2`, `gpt-5.2-codex`) and gains `claude-fable-5.1` and `gemini-3.8-flash`. This regeneration is also what activates the Copilot Fable 5 routing fix, which changed only the generator and so never reached the committed data. Baseten gains `zai-org/GLM-5.3-Fast`, Cloudflare AI Gateway gains `claude-fable-5.1`, and OpenCode Go gains `omen-alpha`.

Removals only take effect through regenerated data: the remote catalog overlay merges by id and can add or update models, but never removes them, so a model that disappears upstream keeps appearing until the committed catalog is refreshed.
