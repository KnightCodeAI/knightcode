---
"@knightcodeai/cli": patch
---

Added `/bug`, which collects a redacted report — version, runtime, model and provider configuration, extensions, settings and this session's error diagnostics, never API keys — and either uploads it to the KnightCode maintainers or writes it as a zip you can attach to an issue yourself. Including the transcript is optional, and declining it offers a model-written summary instead. Crashes are recorded and attached to the next report.
