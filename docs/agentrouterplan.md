# Add AgentRouter as a built-in provider

## Context

KnightCode ships ~40 built-in providers in `packages/ai/src/providers/`. AgentRouter
(agentrouter.org) is a gateway that fronts several frontier models behind one API key, and
it is not one of them. Today a user can only reach it by hand-writing a custom provider in
`~/.knightcode/agent/models.json`, which skips the generated catalog, `/login`, and the
default-model entry.

AgentRouter is a `new-api` deployment. Two of its endpoints are public and unauthenticated,
and together they are the authoritative source for this provider.

**`GET https://agentrouter.org/api/pricing`** — model list, prices, endpoint support:

| model_name | model_ratio | completion_ratio | supported_endpoint_types |
| --- | --- | --- | --- |
| `claude-opus-4-8` | 4 | 5 | anthropic, openai |
| `claude-opus-5` | 4 | 5 | anthropic, openai |
| `gpt-5.6-sol` | 1.5 | 5 | openai |
| `glm-5.3` | 1.5 | 4 | anthropic, openai |
| `deepseek-v4-flash` | 1 | 3 | anthropic, openai |

plus `group_ratio: { default: 1 }`. No `cache_ratio` or `create_cache_ratio` on any entry.

**`GET https://agentrouter.org/api/status`** — `quota_per_unit: 500000`.

Outcome: `AGENTROUTER_API_KEY=... knightcode --model agentrouter/claude-opus-5` works,
`/login` lists AgentRouter, `/cost` reports real spend, and the catalog stays regenerable.

## Pricing model, verified against new-api source

Checked against `QuantumNous/new-api@main` rather than inferred from the API shape:

| Claim | Evidence |
| --- | --- |
| `model_ratio 1` = $2 per 1M input tokens | `common/constants.go:22` — `var QuotaPerUnit = 500 * 1000.0 // $0.002 / 1K tokens`. Matches the live `/api/status` value. |
| per-token price = `model_ratio / quota_per_unit` | `service/quota.go` — `quotaPrice := priceData.ModelRatio / common.QuotaPerUnit` |
| output price = input x `completion_ratio` | `service/quota.go` — `completionPrice := quotaPrice * priceData.CompletionRatio` |
| cache read = input x `cache_ratio`, cache write = input x `create_cache_ratio` | `service/quota.go` — `promptCacheReadPrice := quotaPrice * priceData.CacheRatio`, `promptCacheCreatePrice := quotaPrice * priceData.CacheCreationRatio` |
| `quota_type 0` = per-token; `1` = fixed `model_price` per call | `model/pricing.go:381-390` |

So:

```
input  $/1M = model_ratio * group_ratio * 1e6 / quota_per_unit      (= model_ratio * $2 today)
output $/1M = input $/1M * completion_ratio
```

giving `claude-opus-5` and `claude-opus-4-8` at **$8 / $40**, `gpt-5.6-sol` at **$3 / $15**,
`glm-5.3` at **$3 / $12**, `deepseek-v4-flash` at **$2 / $6**.

**Prices must come from AgentRouter, not from a list-price fallback.** AgentRouter charges
~1.6x Anthropic list for Opus but *less* than OpenAI list for `gpt-5.6-sol` — their prices
diverge from upstream in both directions, so deriving cost from `data.anthropic` /
`data.openai` would be wrong either way. models.dev publishes the `agentrouter` provider but
carries **no `cost` field at all** for it (verified directly against `api.json`), so leaving
the generator's usual `m.cost?.input || 0` fallback in place would silently ship a $0
catalog.

## Where the implementation diverged from this plan

Two things this plan did not know, both settled live on 2026-09-01 and recorded in code:

- **Default model is `glm-5.3`, not `claude-opus-5`.** AgentRouter funds channels from
  per-model budget pools, and the Opus and `gpt-5.6-sol` pools are exhausted (402, under
  every client), so `claude-opus-5` as the default would name a model that always fails.
- **Every model carries an allowlisted `User-Agent`.** AgentRouter rejects unlisted clients
  before auth ("unauthorized client detected"); `knightcode/` is not on the list. See
  `AGENTROUTER_CLIENT_USER_AGENT` in the generator.

- **AgentRouter is not reachable from CI.** GitHub runner IPs get HTTP 200 with an HTML
  interstitial instead of the API payload, so the generator falls back to the committed
  `data/agentrouter.json` rather than failing the catalog publish. Prices refresh whenever a
  maintainer regenerates from a reachable network.

"Open risk" below was settled the same day: the GLM and GPT relays do normalize to standard
OpenAI shape, the DeepSeek one does not, so `isDeepSeek` was extended for that model only.

## Decisions taken

- **Dual API.** Claude models route through `anthropic-messages` at
  `https://agentrouter.org` (the SDK appends `/v1/messages`); everything else through
  `openai-completions` at `https://agentrouter.org/v1`. The `openai-completions` path drops
  Anthropic thinking signatures, which breaks extended-thinking state across turns on Opus.
  `createProvider` already supports a per-API map (`github-copilot.ts`,
  `cloudflare-ai-gateway.ts`), and streaming dispatches on each model's own `baseUrl`
  (`packages/ai/src/models.ts:758-830`), so both endpoints coexist in one provider.
- **All five models.** `/api/pricing` is the real model list. models.dev only describes
  three of them under `agentrouter`; the other two get capability metadata (name, context
  window, reasoning flags, modalities) from the canonical upstream entry with the same id.
  Cost never comes from the fallback.
- **Default model: `claude-opus-5`.**
- **Cache costs: `cacheRead = 0.1x input`, `cacheWrite = 1.25x input`** — Anthropic's own
  multipliers applied to AgentRouter's input price. See the next section; this is a
  deliberate choice made against contrary evidence, not an unexamined default.

## Cache-cost decision and the evidence against it

AgentRouter publishes no cache ratios, so this value cannot be read and has to be chosen.
The choice is 0.1x / 1.25x. Recording why that is contested, so it can be revisited without
redoing the research:

- `model/pricing.go:391-396` emits `cache_ratio` / `create_cache_ratio` **only** when the
  model has an explicit entry in the configured map.
- AgentRouter's `/api/pricing` omits both for **all five** models — including
  `claude-opus-4-8`, which upstream's stock table
  (`setting/ratio_setting/cache_ratio.go`) sets to `0.1`. That implies their cache map has
  been replaced, not inherited.
- When a model is absent from the map, `GetCacheRatio` returns **1** and
  `GetCreateCacheRatio` returns **1.25** (same file). So new-api's own fallback bills cached
  reads at *full input price*.

If that fallback is what AgentRouter actually runs, this plan understates cache-read cost by
10x — `$0.80/M` reported against `$8.00/M` billed on `claude-opus-5`. Their live console
config is unreadable, so it stays open until measured (verification step 8).

To switch later, change one constant in `fetchAgentRouterModels()`:
`CACHE_READ_RATIO` from `0.1` to `1`. Nothing else depends on it.

## Changes

AGENTS.md ("Adding a Provider") is the procedure; this follows it.

### 1. `packages/ai/scripts/generate-models.ts` — new `fetchAgentRouterModels()`

Add it beside `fetchOpenRouterModels()` (line 1056) and `fetchAiGatewayModels()` (line 1120),
copying their shape exactly: `try` / `if (!response.ok) throw` / `console.log` count /
`catch { if (generatorOptions.strict) throw error; return []; }`. Call it from
`generateModels()` and spread the result into `allModels` alongside the other two
(line ~2384).

Behaviour:

1. `GET /api/status` for `quota_per_unit`; `GET /api/pricing` for `data[]` and `group_ratio`.
   Derive `usdPerMillion = model_ratio * (group_ratio.default ?? 1) * 1e6 / quota_per_unit`.
   Do not hardcode `2` or `500000` — both are published, and hardcoding them silently
   doubles or halves every price if AgentRouter re-denominates.
2. Skip entries with `quota_type !== 0` (fixed `model_price` per call, not per-token — none
   today, but the field exists and this cost model assumes per-token).
3. Resolve capability metadata for each `model_name`, first match wins:
   `data.agentrouter?.models[id]`, then `data.anthropic`, `data.openai`, `data.deepseek`,
   `data.zai`. Skip the model if none has it — without a context window there is nothing
   sane to emit. Remember which source matched.
4. `isAnthropic = supported_endpoint_types.includes("anthropic")` **and** the metadata is
   Anthropic-family (matched `data.anthropic`, or the agentrouter entry tags
   `provider.npm === "@ai-sdk/anthropic"`). `glm-5.3` and `deepseek-v4-flash` advertise the
   `anthropic` endpoint too, but that is new-api's translation shim — their native shape is
   OpenAI, so they must stay on `openai-completions`.
5. Emit `api`/`baseUrl` from that flag; `reasoning`/`input`/`contextWindow`/`maxTokens`/`name`
   from the metadata; `cost` from the derived prices via the existing `roundCost()`
   (line 1006), with `cacheRead = input * CACHE_READ_RATIO` and
   `cacheWrite = input * CACHE_WRITE_RATIO`. Define both as named constants next to a
   comment that states they are estimates and points at the section above. Then call
   `recordModelsDevReasoningOptions("agentrouter", id, metadata)` so the effort→thinking-level
   map is derived like every other provider's.

Also add `agentrouter` to one existing branch: the `deepseek-v4-flash` thinking-map check at
`generate-models.ts:919` currently reads
`(model.provider === "deepseek" || model.provider === "opencode" || model.provider === "opencode-go")`.
Without `agentrouter` there, `deepseek-v4-flash` gets `DEEPSEEK_V4_THINKING_LEVEL_MAP`
instead of `DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP`.

Everything else applies for free: `applyThinkingLevelMetadata`,
`isAnthropicAdaptiveThinkingModel`, and `isAnthropicTemperatureUnsupportedModel` key off
model id and `model.api`, not a provider allowlist, so the Opus models pick up
`forceAdaptiveThinking`, `xhigh`/`max`, and `supportsTemperature: false` automatically.

### 2. Run the generator

`bun run generate:models`, then `bun run check:model-data`.

This writes, with no hand-editing (emit loop at `generate-models.ts:2900-3010`):
`packages/ai/src/providers/data/agentrouter.json`, `data/.manifest.json`,
`packages/ai/src/providers/agentrouter.models.ts`, `packages/ai/src/models.generated.ts`.

### 3. `packages/ai/src/providers/agentrouter.ts` — new file

```ts
import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { AGENTROUTER_MODELS } from "./agentrouter.models.ts";

export function agentrouterProvider(): Provider<"anthropic-messages" | "openai-completions"> {
	return createProvider({
		id: "agentrouter",
		name: "AgentRouter",
		baseUrl: "https://agentrouter.org/v1",
		auth: { apiKey: envApiKeyAuth("AgentRouter API key", ["AGENTROUTER_API_KEY"]) },
		models: Object.values(AGENTROUTER_MODELS),
		api: {
			"anthropic-messages": anthropicMessagesApi(),
			"openai-completions": openAICompletionsApi(),
		},
	});
}
```

### 4. Registration and wiring — one line each

- `packages/ai/src/types.ts:35` — add `| "agentrouter"` to `KnownProvider`.
- `packages/ai/src/providers/all.ts` — `import { agentrouterProvider } from "./agentrouter.ts";`
  and add `agentrouterProvider(),` to `builtinProviders()`. Both lists are alphabetical.
- `packages/ai/src/env-api-keys.ts` — `agentrouter: "AGENTROUTER_API_KEY",` in `envMap`.
- `packages/cli/src/core/model-resolver.ts` — `agentrouter: "claude-opus-5",` in
  `defaultModelPerProvider`. That is `Record<KnownProvider, string>`; omitting it fails
  `check-types`.

Nothing is needed for `/login`, `/model`, auth storage, or the remote-catalog overlay —
those enumerate the registry (`getLoginProviderOptions`, `model-runtime.ts:182`).

### 5. Docs

- `packages/cli/docs/providers.md` — add `| AgentRouter | `AGENTROUTER_API_KEY` | `agentrouter` |`
  to the API-key table (~line 70). Markdown here is hand-wrapped; do not run Prettier on it.
- `packages/cli/src/cli/args.ts:~402` — add `AGENTROUTER_API_KEY` to the `--help` env-var
  block, keeping the existing column alignment.

### 6. Tests — `packages/ai/test/agentrouter-models.test.ts`

Follow `xiaomi-models.test.ts` / `baseten-models.test.ts` (Vitest, `getModels` from
`../src/compat.ts`). AGENTS.md requires catalog presence plus request construction. Cover:

- all five model ids present in `getModels("agentrouter")`;
- `claude-opus-5` / `claude-opus-4-8` have `api: "anthropic-messages"` and
  `baseUrl: "https://agentrouter.org"`; `gpt-5.6-sol`, `glm-5.3`, `deepseek-v4-flash` have
  `api: "openai-completions"` and `baseUrl: "https://agentrouter.org/v1"`;
- every model has `cost.input > 0` and `cost.output > 0` — the regression guard for the
  $0-catalog failure mode, and the reason the provider exists in this shape;
- `cost.cacheRead` is `0.1 * cost.input` and `cost.cacheWrite` is `1.25 * cost.input`,
  within a rounding tolerance. This pins the contested ratios so a future change to them is
  a deliberate edit rather than a silent drift.

Assert *relationships*, not literal dollar figures. Prices are fetched live at generation
time, so `expect(cost.input).toBe(8)` would break the suite the day AgentRouter reprices.

No live-key test. If one is ever wanted it must be `agentrouter-*-e2e.test.ts` gated on
`it.skipIf(!process.env.AGENTROUTER_API_KEY)`.

Existing tests that must still pass unchanged:
`packages/cli/test/model-resolver.test.ts` ("built-in defaults exist in generated provider
catalogs" iterates every builtin) and `packages/ai/test/providers.test.ts`.

### 7. Changeset

`.changeset/<name>.md` with a patch bump for `@knightcodeai/cli`:

```md
---
"@knightcodeai/cli": patch
---

Add AgentRouter as a built-in provider
```

## Verification

1. `bun run generate:models` then `bun run check:model-data` — must print
   "Generated model data is valid."
2. Read the generated `packages/ai/src/providers/data/agentrouter.json` and confirm five
   models, non-zero costs, and the anthropic/openai `baseUrl` split. Diff `glm-5.3` and
   `deepseek-v4-flash` against `data/zai.json` and `data/deepseek.json` to see which compat
   flags differ (see "Open risk" below).
3. `bun run check-types` from the repo root, full output, zero errors.
4. `cd packages/ai && bun x vitest --run test/agentrouter-models.test.ts`
5. `cd packages/ai && bun x vitest --run test/providers.test.ts test/env-api-keys.test.ts`
   and `cd packages/cli && bun x vitest --run test/model-resolver.test.ts`
   (per-package, not the full suite — full runs flake on Windows).
6. `bun x prettier --check "packages/ai/src/providers/agentrouter.ts" "packages/ai/test/agentrouter-models.test.ts"`
7. End to end with a real key, if one is available:
   `AGENTROUTER_API_KEY=... bun run start --model agentrouter/claude-opus-5 -p "say hi"`,
   then once each with `--model agentrouter/gpt-5.6-sol` and `--model agentrouter/glm-5.3`
   to exercise both endpoints. Skip and say so if no key is available rather than claiming
   it passed.
8. **Settle the cache ratio empirically.** Run one `claude-opus-5` turn long enough to
   create a cache entry, then a second turn that reads it. Compare KnightCode's reported
   cost for the second turn against the quota actually deducted in AgentRouter's console
   log for that request. If the console charge is ~10x the reported figure, their
   `cache_ratio` is the new-api default of `1` and `CACHE_READ_RATIO` should become `1`.

## Open risk to settle at step 7

`detectOpenAICompletionsCompat` (`generate-models.ts:626`) infers wire-format quirks from
provider id and base URL. Under `provider: "agentrouter"` none of its branches fire, so
`glm-5.3` gets `thinkingFormat: "openai"` (not `"zai"`) and `deepseek-v4-flash` gets no
`requiresReasoningContentOnAssistantMessages`. That is correct *if* the new-api relay
normalizes responses to standard OpenAI shape, and wrong if it passes the upstream shape
through. It cannot be settled without a live key.

If step 7 shows thinking coming back malformed on those two, the fix is to extend `isZai` /
`isDeepSeek` in `detectOpenAICompletionsCompat` to match `provider === "agentrouter"` on
those specific model ids. Do not pre-emptively add it.

## Not doing

- No OAuth flow — AgentRouter is API-key only.
- No entry in `packages/cli/src/core/provider-attribution.ts` (that is for OpenRouter/NVIDIA
  referrer headers).
- No `apps/web` docs edit; that content is already out of sync with `packages/cli` and is
  outside this change.
- No `utils/overflow.ts` entry until a real overflow message is observed from the endpoint.
