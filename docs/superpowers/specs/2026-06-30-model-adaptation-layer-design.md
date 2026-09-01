# Model Adaptation Layer — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design); pending implementation plan
**Owner:** Raghav Seth
**Component:** `packages/cli/src/utils/model/profile/` (new), integrated into `packages/cli/src/services/api/knightcode.ts`

---

## 1. Problem

KnightCode is a faithful port of the Claude Code harness adapted to BYOK / OpenRouter. The harness itself is excellent, but it was built for a single model family (Claude) and sends **Claude-native signals to every model**. Non-Claude / open-weight models therefore run crippled, which reads to users as "the harness is dumb."

Verified findings (live OpenRouter probes + source diff against `shenanigans/opencode` and `shenanigans/claude-code-source`):

- **Sampling is untuned.** The harness sends `temperature: 1` to all models (`knightcode.ts:1695`). opencode sets per-model temperatures (qwen 0.55, kimi 0.6, gemini 1.0, claude → omit). *Proof: `nvidia/nemotron-3-ultra-550b` took 80s at temp 1 vs 25s tuned.*
- **Reasoning is not enabled for open models.** The harness sends `thinking:{type:'adaptive'}` (Anthropic-only) and, on the default BYOK path, no OpenRouter `reasoning` param (effort resolves to `undefined`; `effort.ts:464-493`). Many open models emit no reasoning without a provider-specific flag (`reasoning:{effort}`, `enable_thinking`, `chat_template_args.enable_thinking`).
- **No answer-token budgeting.** Reasoning can consume the entire `max_tokens`, leaving an empty final answer. *Proof: `poolside/laguna-m.1` returned 4275 reasoning chars and an empty answer.*
- **No per-model tool-schema or message fixups.** opencode rewrites tool schemas for Gemini (int→string enums), Moonshot/Kimi (`$ref`), scrubs Mistral tool-call IDs, and forces DeepSeek reasoning blocks. Without these, tool calls fail in the agentic loop — the worst-hit area for a tool-heavy harness.
- **Context window mis-sized.** `utils/context.ts:81` falls back to 200k for every model until the `/model` picker is opened once (the only code that warms the OpenRouter model cache). Causes premature autocompaction on large-context models and 413s on small ones.
- **Provider routing unpinned.** No OpenRouter `provider` object is sent, so requests free-route across backends (Anthropic/Bedrock/Novita/DeepInfra/Nvidia/Poolside…) with differing quantization and parameter support.
- **Reliability.** Free-tier favourites frequently 429 (3 of 7 `openRouterFavorites` returned 429 in a live probe).

**Explicitly NOT a problem (verified, do not touch):** Anthropic extended thinking works — OpenRouter honors `thinking:{type:'adaptive'}` and routes default `anthropic/*` to provider "Anthropic", returning real thinking tokens. The agentic loop, tool-result pairing, compaction thresholds, temperature/token math, and retry logic are faithful ports.

## 2. Goal & Non-Goals

**Goal:** A cohesive, isolated, fully tested subsystem that adapts request construction per model — sampling, reasoning enablement + budget, tool-schema sanitization, message normalization, context sizing, and provider routing — so any model on OpenRouter runs as well as it can. "If open models work great, every model works great" becomes literally true.

**Non-Goals (YAGNI):**
- No Bedrock/Vertex/Azure/Copilot provider ports — KnightCode is OpenRouter-BYOK.
- No generic multi-provider abstraction; we speak OpenRouter's Anthropic-compatible `/v1/messages` (current client) only.
- The existing Anthropic `thinking` behavior is preserved as-is, merely routed through the new reasoning applier.
- Identity/branding prompt changes are out of scope (user keeps KnightCode branding everywhere).

## 3. Architecture — 4 Layers

### Layer 1 — Capability Catalog (live data + cache)
Source of truth for *what a model can do*.

- Fetch `GET https://openrouter.ai/api/v1/models` (and per-model `supported_parameters` where available).
- Fields consumed per entry: `context_length`, output token limit, `supported_parameters` (set: `reasoning`, `temperature`, `top_p`, `top_k`, `tools`, `structured_outputs`, …), input modalities, provider/author slug.
- **Warmed at boot** (async, non-blocking) — not only when the model picker opens. Cached to `~/.knightcode/cache/openrouter-models.json` with a TTL (default 24h). A bundled snapshot ships in-repo as an offline/first-run fallback.
- Accessor: `getModelCatalogEntry(modelId): CatalogEntry | undefined`.
- **Replaces** the cold-cache logic in `utils/model/openRouterModels.ts` + the 200k fallback in `utils/context.ts:81`.

### Layer 2 — Quirks Registry (hand-curated code)
What catalogs cannot encode. Ported and extended from `shenanigans/opencode/packages/opencode/src/provider/transform.ts`.

- A list of `QuirkRule` objects, each with a `match(modelId): boolean` (substring/regex) and a partial `ModelProfileOverride`.
- Overrides may set: `sampling` (temperature/top_p/top_k), `reasoning` strategy, `extraBody` (e.g. `chat_template_args.enable_thinking`, `provider` routing), `schemaTransforms`, `messageTransforms`.
- Rules compose; precedence is explicit (more-specific id match wins; ties broken by registry order, documented in `quirks.ts`).
- Seed content (initial): qwen (temp 0.55, top_p 1), kimi-k2 (temp 0.6/1.0), gemini (top_p 0.95, top_k 64, int→string enums), minimax (top_k 20/40), deepseek (reasoning-block message fix), mistral/devstral (tool-id scrub, tool→user "Done." insert), moonshot/kimi ($ref schema sanitize), zai/zhipuai (`thinking:{type:'enabled',clear_thinking:false}`), alibaba/dashscope (`enable_thinking:true`). Anthropic → no sampling override (omit temperature), keep adaptive thinking.

### Layer 3 — Resolver + Appliers
`resolveModelProfile(modelId): ModelProfile` merges Catalog (L1) + Quirks (L2) into one immutable, memoized object. The profile drives small, **pure, total** applier functions:

| Applier | Responsibility | Seam in `knightcode.ts` |
|---|---|---|
| `applySampling(profile, body)` | set temperature/top_p/top_k — only params the catalog marks supported | `paramsFromContext` return body |
| `applyReasoning(profile, body, {effort, thinkingConfig})` | choose correct reasoning signal: Anthropic `thinking` (kept) · OpenRouter `reasoning:{effort}` + needed enable flags · none for non-reasoners. Enforce answer-token floor | `paramsFromContext` (replaces hardcoded temperature + thinking block) |
| `sanitizeToolSchema(profile, schema)` | Gemini int→string enums, Moonshot/Kimi `$ref`, etc. | `toolSchemas` build (~`knightcode.ts:1243`) |
| `normalizeMessagesForModel(profile, msgs)` | DeepSeek reasoning blocks, Mistral tool-id scrub + tool→user fix, surrogate sanitize | message normalization (~`knightcode.ts:1274`) |
| `applyProviderRouting(profile, body)` | OpenRouter `provider` object: `require_parameters: true`, order/quality pins | `paramsFromContext` return body |
| `getContextWindow(profile)` / `getMaxOutputTokens(profile)` | catalog-driven sizing | `utils/context.ts` |

**Answer-token floor:** when reasoning is enabled, ensure `max_tokens >= reasoningBudget + MIN_COMPLETION_FLOOR` (configurable; default e.g. 1024) so the final answer is never starved. If the model/catalog caps output below that, scale the reasoning budget down.

### Layer 4 — Fallback chain (phase 2, designed now)
On `429` / `404 unavailable`, fall through `openRouterFavorites` (or a configured fallback list) before erroring. Hooks into the existing `withRetry` (`services/api/withRetry.ts`) fallbackModel mechanism. Built after Layers 1–3 prove out.

## 4. Module Layout

```
packages/cli/src/utils/model/profile/
  index.ts                    # public surface: resolveModelProfile, appliers
  catalog.ts                  # OpenRouter catalog fetch + disk cache + accessor
  catalog.snapshot.json       # bundled offline fallback
  quirks.ts                   # QuirkRule[] registry + matchers
  profile.ts                  # ModelProfile type, resolveModelProfile (memoized)
  appliers/
    sampling.ts
    reasoning.ts
    schema.ts
    messages.ts
    providerRouting.ts
    tokens.ts
  *.test.ts                   # colocated unit tests per file
  contract.live.test.ts       # opt-in (env-gated) live probe of openRouterFavorites
```

Each unit answers: what it does, how to use it, what it depends on. Appliers depend only on a `ModelProfile` + the body fragment they edit (no global state), so they're independently testable.

## 5. Data Flow

```
boot ──► catalog.warm() (async, cached)
                  │
query ──► resolveModelProfile(modelId)  ◄── catalog entry + matching quirks
                  │
   ┌──────────────┼───────────────────────────────────────────────┐
   ▼              ▼                       ▼                          ▼
toolSchemas   messages norm        paramsFromContext            context.ts
sanitizeTool  normalizeMessages    applySampling                getContextWindow
 Schema        ForModel            applyReasoning               getMaxOutputTokens
                                   applyProviderRouting
                                   (answer-token floor)
                  │
                  ▼
        OpenRouter /v1/messages
```

## 6. Error Handling

- **Catalog fetch failure:** use bundled snapshot, then conservative defaults; log, never crash.
- **Unknown model** (no catalog entry, no quirk): safe defaults — omit temperature (let provider default), no reasoning unless `supported_parameters` includes `reasoning`, no schema/message mutation. Never send a param the catalog marks unsupported.
- **Appliers** are pure and total: malformed input degrades to a no-op transform, never throws into the request path.
- **Reasoning/answer conflict:** if budgets can't both fit, prefer a non-empty answer (shrink reasoning).

## 7. Testing Strategy

- **Unit (table-driven) per applier:** `(modelId, baseBody) → expectedBody`. Cover Anthropic, qwen, gemini, deepseek, mistral, kimi, nemotron, gpt-oss, an unknown model.
- **Quirks registry:** each rule matches intended ids and not others (precedence cases included).
- **Schema golden tests:** Gemini int-enum and Moonshot `$ref` input→output fixtures.
- **Catalog:** parse fixture JSON; cache TTL + offline-fallback behavior; boot warm is non-blocking.
- **Live contract test (env-gated, uses `.env` `OPENROUTER_API_KEY`):** for each `openRouterFavorites` model send a tiny request and assert 200, params accepted, reasoning present when expected, **non-empty answer**. This is the regression guard that would have caught the laguna empty-answer and the 429s.

## 8. Integration Points (existing code touched)

- `services/api/knightcode.ts`: `paramsFromContext` (return body — sampling/reasoning/provider/answer-floor), `toolSchemas` map (~1243), message normalization (~1274).
- `utils/context.ts:81-90` + `utils/model/openRouterModels.ts`: context-window sizing now reads the catalog.
- `bootstrap`: one-line async catalog warm at startup.
- `utils/effort.ts`: `getDefaultEffortForModel` extended so OpenRouter reasoning-capable models get a sensible default effort (instead of `undefined` → nothing).

## 9. Rollout / Safety

- Behind no flag by default for sampling/context (pure improvements), but each applier respects an escape hatch env var (e.g. `KNIGHTCODE_DISABLE_MODEL_PROFILE`) for debugging.
- Anthropic request shape must be byte-identical to today after the refactor (regression-tested) so the verified-good Claude path is untouched.

## 10. Open Items deferred to plan

- Exact `provider` routing policy per model (order vs `require_parameters` only).
- Phase-2 fallback chain UX (silent vs surfaced).

**Catalog source is OpenRouter only.** models.dev (or any other catalog) is explicitly out of scope — `GET https://openrouter.ai/api/v1/models` is the sole capability source.
