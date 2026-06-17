---
"@knightcodeai/cli": patch
---

Refresh the supported model catalog: add newer free and paid OpenRouter models, repoint aliases to their successors, change the default model, and drop discontinued entries.

### Added

Refresh the supported model catalog with new OpenRouter models: `nvidia/nemotron-3-ultra-550b-a55b:free` (Nemotron 3 Ultra 550B), `nex-agi/nex-n2-pro:free` (Nex N2 Pro), `qwen/qwen3.7-plus` (Qwen3.7 Plus), `z-ai/glm-5.2` (GLM 5.2), and `moonshotai/kimi-k2.7-code` (Kimi K2.7 Code). New `qwen` and `nex` model aliases accompany them.

### Changed

Default model is now `nvidia/nemotron-3-ultra-550b-a55b:free` (was `z-ai/glm-4.5-air:free`). The `glm`, `kimi`, and `nemotron` aliases were repointed to their successor models (`z-ai/glm-5.2`, `moonshotai/kimi-k2.7-code`, `nvidia/nemotron-3-ultra-550b-a55b:free`), and the onboarding shortlist was updated to match the new catalog.

### Removed

Drop discontinued/older version models: `z-ai/glm-4.5-air:free`, `deepseek/deepseek-v4-flash:free`, `z-ai/glm-5.1`, `moonshotai/kimi-k2.6`, and `nvidia/nemotron-3-super-120b-a12b:free`, along with their `glm_air` and `deepseek` aliases.
