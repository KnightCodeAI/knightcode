# KnightCode ← Claude Code on OpenRouter — Transformation Design

**Date:** 2026-06-18
**Status:** Design (awaiting review)
**Source tree:** `shenanigans/claude-code-source` — Anthropic Claude Code CLI v2.1.88, reconstructed TypeScript (~1900 files; `cli.js` is the bundled artifact)
**Target:** Fork the source into KnightCode running entirely on OpenRouter (OpenAI-compatible, BYOK). Replace the current `packages/cli` KnightCode implementation.

---

## 1. Goal

Take the full Claude Code CLI and make every model call go through OpenRouter via KnightCode's existing Vercel AI SDK transport, with **zero runtime dependency on `@anthropic-ai/sdk`** and no Anthropic backend/telemetry/account coupling. Preserve Claude Code's agentic loop, tool system, TUI, and subagents intact.

## 2. Confirmed Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Core architecture | **Two adapters at one transport seam.** Keep Claude Code's internal Anthropic content-block representation. **Vendor** the used subset of `@anthropic-ai/sdk` into a KnightCode-owned `packages/anthropic-compat` package and remove the external dependency. Drive the wire with KnightCode's AI SDK + `@openrouter/ai-sdk-provider` stack. |
| 2 | Config home + env namespace | **`~/.knightcode`, clean break.** New `KNIGHTCODE_*` / `OPENROUTER_*` namespace. No `ANTHROPIC_*` aliases, no `~/.claude` fallback. |
| 3 | Model selection | **Raw OpenRouter slugs only.** No `sonnet`/`opus`/`haiku`/`best` aliases. `/model` lists real slugs from the catalog; agent frontmatter takes a slug string validated against the catalog. |
| 4 | Token counting | **Bundle a real tokenizer now** (per-model where available, best-effort fallback), corrected by the exact usage OpenRouter returns per response. |

## 3. Why this is tractable (the load-bearing facts)

- **One transport seam, two adjacent files.** All API traffic converges on `src/services/api/client.ts` (`getAnthropicClient()` — the client factory) and `src/services/api/claude.ts` (`paramsFromContext()` request builder + the three `.beta.messages.create()` call sites at streaming/non-streaming/`verifyApiKey`, plus the SSE parser loop).
- **The SDK coupling is almost entirely types.** 116 files import from `@anthropic-ai/sdk`; **91 are `import type`**. The complete *runtime* (value) surface is four symbols: `Anthropic` (client class, only in `client.ts`), and error classes `APIError`, `APIUserAbortError`, `APIConnectionTimeoutError`.
- **The Anthropic content-block shape is the internal representation,** not just the wire format: `AssistantMessage.message` *is* a `BetaMessage`; `UserMessage.message.content` is `BetaContentBlockParam[]`. Refactoring that out touches all ~1900 files — so we do **not** do that. We translate at the boundary and keep the shape.

## 4. Architecture — One Seam, Two Adapters, a Vendored Vocabulary

### 4.1 The vendored compat package — `packages/anthropic-compat`

Owns the Anthropic message vocabulary KnightCode depends on. Replaces every `from '@anthropic-ai/sdk/...'` import.

- **Types (the 91 type-only files):** vendor the used `Beta*` shapes — `BetaMessage`, `BetaContentBlock(Param)`, `BetaImageBlockParam`, `BetaToolResultBlockParam`, `BetaToolUnion`, `BetaRawMessageStreamEvent`, `BetaStopReason`, `BetaUsage`, `BetaMessageParam`, `TextBlockParam`, `Stream` type, etc. Pure TypeScript; erases at build. Effectively dev-only weight.
- **Runtime (the 4 value symbols):** reimplement the error classes (`APIError`, `APIUserAbortError`, `APIConnectionTimeoutError`, and `APIConnectionError` referenced in retry) as plain `Error` subclasses carrying `status`/`headers`/`request_id`. A few dozen lines of real runtime code — *our* code.
- **Outcome:** `@anthropic-ai/sdk` (and `bedrock-sdk`/`vertex-sdk`/`foundry-sdk`) leave the dependency tree entirely. The vocabulary is ours to extend.

> Mechanical step: a codemod rewrites the 116 import sites from `@anthropic-ai/sdk[/...]` to `@knightcode/anthropic-compat`. No call-site logic changes.

### 4.2 The two adapters (the only new transport logic)

Live in a new `src/services/api/openrouter/` module:

1. **`convert-request.ts` — `anthropicParamsToAiSdk(params)`**
   Anthropic Messages request → AI SDK `streamText`/`generateText` args.
   - `system` `TextBlockParam[]` → single `system` string (sections joined `\n\n`).
   - `MessageParam[]` content blocks → AI SDK `ModelMessage[]`: `tool_use` → assistant tool-call part; `tool_result` → tool message; `image` → image part; **drop** `thinking`/`document`/`redacted_thinking`.
   - tools → AI SDK function tools from the same `zodToJsonSchema` source of truth; **drop** `strict`/`defer_loading`/`eager_input_streaming`/`cache_control`.
   - `tool_choice` Anthropic → AI SDK mapping.
   - **Strip** `betas`, `metadata`, `cache_control`, `output_config`, `context_management`, `speed`, `anthropic_internal`.

2. **`convert-stream.ts` — `aiSdkStreamToAnthropicEvents(fullStream)`**
   AI SDK normalized `fullStream` parts → the exact `BetaRawMessageStreamEvent` sequence (`message_start` / `content_block_start|delta|stop` / `message_delta` / `message_stop`) that `claude.ts`'s existing `for-await` loop already consumes **unchanged**. Translating to the AI SDK's *normalized* stream (not raw OpenAI deltas) means tool-call argument accumulation, SSE parsing, and usage extraction come for free.

Everything else — `normalizeMessagesForAPI`, `ensureToolResultPairing`, `normalizeContentFromAPI`, the `query.ts` agent loop, subagents, tool definitions — keeps operating on Anthropic blocks and never learns OpenRouter exists.

### 4.3 Reuse boundary — borrow the pipe, keep the brain

**Lift near-verbatim from `packages/cli/src/lib/` + `packages/shared/`:**
- `inference/resolve-model.ts` — OpenRouter client, attribution headers (HTTP-Referer/X-Title/`x-session-id`), `providerOptions.openrouter.usage.include=true`, reasoning mapping, per-session `user` tag. **Highest-value reuse.**
- `credentials.ts` — BYOK storage.
- `onboarding/validate-key.ts` — key validation (`GET /api/v1/key`).
- `shared/models.ts` — catalog/pricing structure (recurate to live slugs).
- `ui/token-stats.ts` — cost from OpenRouter-reported usage.
- `inference/side-query.ts`, `resolve-subagent-model.ts` — id resolvers for side-queries/subagents.

**Do NOT reuse** (would force the 1900-file refactor): KnightCode's `engine/query.ts` turn loop and its `UIMessage` transcript store. Claude Code keeps its own loop and its own Anthropic-block transcript.

## 5. Phased Work Plan

Phases 0 and 8 (telemetry/cloud) are orthogonal to inference and land first / in parallel. Phases 1–3 are the load-bearing transport rewrite (XL, the only real risk concentration). Phases 4–7 follow naturally.

### Phase 0 — Stop the phone-home (no inference change)
Stub at root so nothing contacts `api.anthropic.com`, Datadog, BigQuery, or GrowthBook, while all call sites still compile.
- `analytics/config.ts` → `isAnalyticsDisabled()=true`; `analytics/growthbook.ts` → all gates return passed defaults / `false`, no SDK init, no network; `analytics/sink.ts` → no-op sink (kills Datadog + 1P exporter).
- Build with `feature('BRIDGE_MODE')` **off** → short-circuits `src/bridge/*` Remote-Control.
- Launcher default `DISABLE_TELEMETRY=1`.
- **Risk (named):** a few GrowthBook gates drive real behavior (model overrides, compaction config, auto-update kill switches) — pin curated defaults, don't blanket-`false`.

### Phase 1 — Transport seam + vendored compat package
- Create `packages/anthropic-compat` (§4.1); codemod the 116 import sites.
- `src/services/api/client.ts` — **replace** `getAnthropicClient()` with `getOpenRouterModel()` built on lifted `resolve-model.ts`. Delete Bedrock/Vertex/Foundry branches and their SDK + `@azure/identity` imports. **Keep** `getCustomHeaders`/`getProxyFetchOptions`/`API_TIMEOUT_MS`/`getUserAgent`. Remove OAuth refresh.
- `package.json` — add `ai@^6`, `@ai-sdk/provider-utils@^4`, `@openrouter/ai-sdk-provider@^2.9`, `zod@^4`; remove `@anthropic-ai/{sdk,bedrock-sdk,vertex-sdk,foundry-sdk}`.
- **Risk (medium):** emulate the `.withResponse()`/`request_id` correlation contract (map OpenRouter completion `id`); align bundled zod vs `zod@^4`.

### Phase 2 — Request translation
- Add `convert-request.ts` (§4.2.1). Route `src/utils/api.ts` `toolToAPISchema` + `buildSystemPromptBlocks` through it (collapse system to plain text, drop `cache_control`/dynamic boundary).
- `claude.ts` `paramsFromContext` (~L1538–1729): remove `betas`, `thinking` (→ `reasoning` only where catalog supports), `output_config`, `context_management`, `speed`; `addCacheBreakpoints` → pass-through.
- `constants/system.ts` — remove billing/attribution prefix; rebrand identity line to KnightCode.
- **Risk (high):** tool-call `id` round-trip stability (`ensureToolResultPairing` keys on ids; upstream ids differ from `toolu_*`) — converter holds a stable bidirectional id map. Flatten image-bearing `tool_result` blocks (AI SDK tool messages are string-oriented).

### Phase 3 — Response/stream translation
- Add `convert-stream.ts` (§4.2.2). Rewrite `executeNonStreamingRequest()` (L864) and `verifyApiKey()` (L555) onto `generateText` / a tiny key probe.
- `logging.ts` + `utils/tokens.ts` — map usage (`prompt_tokens→input_tokens`, `completion_tokens→output_tokens`, cache fields→0); read true cost from `providerMetadata.openrouter.usage.cost`.
- `errors.ts` + `withRetry.ts` — replace Anthropic `instanceof`/529-overloaded checks with AI SDK error types + standard 429/5xx; drop `stop_reason==='refusal'`; map `finish_reason` (`length→max_tokens`, `tool_calls→tool_use`, `stop→end_turn`).
- **Risk (high):** subtlest correctness surface — keep `claude.ts`'s existing "detect tool_use during streaming, don't trust stop_reason" logic; synthesize `content_block_start/stop` framing the AI SDK doesn't emit explicitly.

### Phase 4 — Auth → single BYOK Bearer key
- **Remove** `src/services/oauth/*`, `constants/oauth.ts`. In `utils/auth.ts`: `isClaudeAISubscriber()=false`, `getSubscriptionType()=null`; reduce auth to `{env key | apiKeyHelper | stored key}`; delete token cache/refresh/401 + AWS/GCP refresh.
- `utils/http.ts` `getAuthHeaders` → always `Authorization: Bearer <key>`.
- `commands/login/login.tsx` → API-key input dialog; `cli/handlers/auth.ts` → key entry/clear/status.
- Lift KC `credentials.ts` (storing in `~/.knightcode/credentials.json` @0600) + `validate-key.ts`; accept `sk-or-v1-*`.
- **Risk (low-med):** breadth of subscription/org-gated UI call sites.

### Phase 5 — Model catalog (raw slugs)
- **Replace** `utils/model/configs.ts`/`modelStrings.ts` with a slug catalog from curated `shared/models.ts` + live `GET /api/v1/models` (disk-cached as in `modelCapabilities.ts`). `modelCost.ts`/`context.ts`/`effort.ts` read pricing/`context_length`/`supported_parameters` per slug.
- **Remove the alias layer.** The 17 call sites of `getDefaultSonnetModel`/`getDefaultOpusModel`/`getSmallFastModel` collapse to two configured slots: **`getMainModel()`** and **`getFastModel()`**, each a user-configured OpenRouter slug. `/model` picker (`commands/model/model.tsx`) lists real slugs. `validateModel.ts` → catalog lookup.
- `tools/AgentTool/AgentTool.tsx:86` — `model: z.enum(['sonnet','opus','haiku'])` → slug string validated against the catalog. Built-in agents (`statuslineSetup.ts` etc.) → `'inherit'` or an explicit slug.
- Remove `antModels.ts`, `check1mAccess.ts`, `[1m]`/`opusplan`/fast-mode/Sonnet1m experiments, all `USER_TYPE==='ant'` branches.
- **Risk (low):** mostly mechanical.

### Phase 6 — Betas, token counting, reasoning
- `utils/betas.ts` `getMergedBetas`→`[]`; `constants/betas.ts` dead. Disable caching machinery (`getCacheControl`, `should1hCacheTTL`, `promptCacheBreakDetection.ts`, microcompact `cache_edits`).
- **Token counting:** remove the `beta.messages.countTokens` path in `services/tokenEstimation.ts`. **Bundle a tokenizer** (`js-tiktoken`/`gpt-tokenizer`, o200k/cl100k) for pre-flight context/compaction counts — per-model where the model's family is known, best-effort fallback otherwise (note: Anthropic's exact tokenizer isn't publicly bundled; Claude-family slugs use the closest available approximation). Authoritative post-hoc counts come from response usage.
- Map `thinking`→`reasoning` only for slugs whose `supported_parameters` include it; hide effort UI for non-reasoning models (some error on unknown params).
- Remove advisor/`web_search`/`web_fetch` server tools; WebSearch/WebFetch become local client-side tools.
- **Risk (medium):** compaction decisions ride on estimates pre-flight, corrected post-response.

### Phase 7 — Env/config + subagents
- `utils/managedEnvConstants.ts` — rewrite `SAFE_ENV_VARS`/`PROVIDER_MANAGED_ENV_VARS` to the OpenRouter set; drop AWS/Vertex/Foundry/OAuth.
- `utils/envUtils.ts` — config home → `~/.knightcode` (clean break; `KNIGHTCODE_CONFIG_DIR` override).
- `utils/model/agent.ts` — drop Bedrock region-prefix; slug resolver. **Keep** `runAgent.ts`/`spawnMultiAgent.ts`/`loadAgentsDir.ts` orchestration unchanged — subagents reach transport via the shared `query()` and inherit OpenRouter for free.
- **Risk (low).**

### Phase 8 — Delete dead cloud/account surface
Delete (not just stub): `src/bridge/*` + remote hooks; `services/api/{usage,overageCreditGrant,referral,claudeAiLimits,grove,firstTokenDate,metricsOptOut}.ts` + their UI; `components/Feedback.tsx` (or repoint `/feedback`+`/bug` to a KnightCode GitHub repo via existing `createGitHubIssueUrl`); `install-github-app`, `install-slack-app`; `filesApi.ts`; `bigqueryExporter.ts`. Repoint `release-notes` to KnightCode.
- **Risk (low-med):** confirm bridge-shared hooks (`sdkMessageAdapter`, `concurrentSessions`) aren't used by local-session flows before deleting.

## 6. Hardest couplings — chosen approach

| Coupling | Approach |
|---|---|
| **Streaming shape** | `aiSdkStreamToAnthropicEvents` over the AI SDK *normalized* `fullStream`. `claude.ts`'s parser stays byte-for-byte unchanged. Keep "detect tool_use mid-stream, don't trust stop_reason." |
| **Token counting** | No OpenRouter endpoint. Bundle tokenizer for pre-flight; authoritative counts from response usage. |
| **Prompt caching** | No `cache_control` in the AI SDK shape. Strip all; rely on OpenRouter sticky routing via `x-session-id`. Subagent "identical-prefix" optimization becomes inert but harmless. |
| **OAuth** | Rip entirely; one static BYOK key; `/login` = key dialog. |
| **Subagents** | Zero orchestration change; only slug resolution differs. |
| **SDK vocabulary** | Vendored `packages/anthropic-compat`; external Anthropic packages removed. |

## 7. Rip-out set (so the fork never phones home)
GrowthBook · 1P event logging · Datadog · BigQuery metrics · Bridge/Remote-Control/mobile (~40 files) · account/cost endpoints (usage/overage/referral/limits/grove/firstTokenDate/metricsOptOut) + UI · feedback/bug · install-github-app · install-slack-app · Files API · bootstrap catalog path · fast-mode OAuth endpoint · server tools (advisor, web_search, web_fetch). Defense-in-depth: launcher ships `DISABLE_TELEMETRY=1`.

## 8. Remaining open items (smaller; can be resolved during implementation)
1. **Repo integration:** does the forked source *become* `packages/cli` (replacing it), with `resolve-model.ts`/`credentials.ts`/etc. promoted to a shared `packages/inference` both consume — or does it live as a new app importing the existing `packages/cli/src/lib`? (Affects where lifted modules live, not the transport design.)
2. **Reasoning/effort UX** for mixed reasoning/non-reasoning slugs: hide vs. show-and-drop the effort control per model.
3. **Structured outputs:** map `output_config.format` → AI SDK `response_format` json_schema only for supporting slugs, or drop entirely?
4. **`/feedback` + `/bug`:** delete, or repoint to a KnightCode GitHub issues repo.

## 9. Effort
Phases 1–3 (transport) are **XL** and the only real risk concentration. Phases 0, 4–8 are **L/M** and largely mechanical. Recommended order: land Phase 0 immediately (stops phone-home, unblocks safe iteration), then 1→2→3 as one tightly-reviewed transport milestone before touching the rest.
