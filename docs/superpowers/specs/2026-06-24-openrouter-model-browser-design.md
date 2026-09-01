# OpenRouter Model Browser — Design Spec

**Date:** 2026-06-24
**Status:** Draft — pending review
**Scope:** Make the full OpenRouter model catalog the canonical model experience across knightcode, with a favorites system and per-model reasoning-effort gating.

---

## 1. Background & Motivation

knightcode is an OpenRouter BYOK fork of Claude Code. The API client already targets
OpenRouter (`OPENROUTER_BASE_URL = 'https://openrouter.ai/api'`, `OPENROUTER_API_KEY`),
but model selection still uses Claude Code's hardcoded Anthropic lists
(`getModelOptions`, `getAgentModelOptions`) and an Anthropic-keyed effort system.

The user wants:
1. The user to select from **every model OpenRouter offers right now**.
2. A picker UI styled like the existing **Config** component, with two tabs — **All models**
   and **Favorites** — where **Space** toggles a model into favorites.
3. OpenRouter models available **everywhere** a model is chosen.
4. The **full reasoning-effort ladder** integrated such that a model can **never** be called
   with an effort level it does not support.

## 2. Goals

- Fetch and present the live OpenRouter model catalog.
- A reusable two-tab (Favorites / All models) browser that replaces the current model picker.
- Global, persistent favorites.
- Per-model reasoning-effort capability with a hard "unsupported effort can never be sent"
  guarantee.

## 3. Non-Goals

- Per-agent / per-project model selection. Subagents **always inherit** the main-loop model
  for now (see §7).
- Teammate-model selection (currently an inert stub — out of scope).
- Exposing OpenRouter's `max_tokens` thinking-budget control (effort levels only).
- The `max` effort tier over OpenRouter (Anthropic-native only; intentionally excluded).

## 4. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Catalog source | **OpenRouter live API** `GET /api/v1/models` (not models.dev) |
| 2 | Entry point | **Replace** the no-arg `/model` picker (and Config "Model" row) with the new browser |
| 3 | Row content | Name + id, pricing, context length, modalities/capabilities |
| 4 | Favorites storage | **Global** config; picker opens on **Favorites** if any exist, else **All models** |
| 5 | Context formatting | `1M` / `262K` style, **no emojis** (plain dimmed text tags) |
| 6 | Subagent models | **Always `inherit`**; remove the wizard's model step |
| 7 | Effort fallback | Reasoning-capable but unrecognized model → offer **low/medium/high** |
| 8 | Out-of-range effort | **Clamp down** to nearest supported level ≤ requested |

---

## 5. Architecture Overview

```
                 ┌─────────────────────────────┐
                 │  OpenRouter /api/v1/models   │  (live, 1h disk cache)
                 └──────────────┬──────────────┘
                                │
                 ┌──────────────▼──────────────┐
                 │  utils/model/openRouterModels│  fetch + cache + normalize
                 │  - OpenRouterModel[]         │  capability flags
                 │  - getSupportedEffortLevels()│
                 └───────┬───────────────┬──────┘
                         │               │
        ┌────────────────▼───┐   ┌───────▼───────────────┐
        │ favorites store     │   │ ModelBrowser.tsx      │
        │ (global config)     │◄──┤ Favorites / All tabs  │
        └─────────────────────┘   │ Space=fav, effort sel │
                                   └───────┬───────────────┘
                                           │ used by
                         ┌─────────────────┼──────────────────┐
                         ▼                 ▼                   ▼
                  /model (no-arg)   Config "Model" row   (ModelPicker removed)
```

Effort enforcement is centralized: every request path resolves effort through
`resolveAppliedEffort()`, which clamps against `getSupportedEffortLevels(model)`.

---

## 6. Components

### 6.1 `utils/model/openRouterModels.ts` (new)

**Responsibility:** Fetch, cache, and normalize the OpenRouter catalog; expose per-model
capability queries.

**Fetch:** `GET https://openrouter.ai/api/v1/models` with `Authorization: Bearer
$OPENROUTER_API_KEY` and the standard referer/title headers already used by the client.

**Caching (mirrors OpenCode's models.dev approach):**
- Disk cache as JSON in the knightcode cache dir, TTL ~1 hour.
- In-memory memo for the process lifetime.
- On fetch failure, fall back to stale disk cache; if no cache exists, surface an error
  state to the UI (see §6.2 error state).

**Normalized type:**
```ts
type OpenRouterModel = {
  id: string                 // "anthropic/claude-3.5-sonnet"
  name: string               // "Anthropic: Claude 3.5 Sonnet"
  contextLength: number      // 200000
  pricing: { prompt: number; completion: number }  // USD per token (from API)
  inputModalities: string[]  // architecture.input_modalities, e.g. ["text","image"]
  supportsTools: boolean     // supported_parameters includes "tools"
  supportsReasoning: boolean // supported_parameters includes "reasoning"
}
```

**Public API:**
- `getOpenRouterModels(): Promise<OpenRouterModel[]>` — cached fetch.
- `getOpenRouterModel(id): OpenRouterModel | undefined` — lookup from memo.
- `getSupportedEffortLevels(model: string): EffortLevel[]` — see §8.
- `formatContextLength(n: number): string` — `1000000 → "1M"`, `262144 → "262K"`.
- `formatPricing(p): string` — `"$3.00/$15.00"` per 1M tokens (input/output).

### 6.2 `components/ModelBrowser.tsx` (new)

**Responsibility:** The reusable picker UI. Styled with the same primitives as the Config
component: design-system `Tabs`/`Tab`, `SearchBox`, and a scrollable selectable list.

**Props:**
```ts
type Props = {
  initial: string | null
  onSelect: (modelId: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
}
```

**Tabs:** `Favorites` and `All models`. Opens on **Favorites** when the favorites list is
non-empty, else **All models**.

**Search:** A `SearchBox` filters the active tab by `name` and `id` (same pattern as Config).

**Row layout (no emojis):**
```
★ Claude 3.5 Sonnet                  $3.00/$15.00 · 200K · vision · tools
  anthropic/claude-3.5-sonnet
```
- Line 1: `★`/`☆` favorite marker, bold name, then dimmed metadata —
  `pricing · context · [vision] · [tools] · [thinking]`.
  - `vision` shown when `inputModalities` includes `image`.
  - `tools` shown when `supportsTools`.
  - `thinking` shown when `supportsReasoning`.
- Line 2: dimmed model id.

**Effort line (below the list, reflects the focused model):**
- If `getSupportedEffortLevels(focused)` is non-empty → a selector cycling **only** those
  levels via ←/→, with the current level highlighted.
- If empty → dimmed `Thinking: not supported`.

**Keys:**
| Key | Action |
|-----|--------|
| ↑ / ↓ | Move focus within the list |
| Space | Toggle focused model in favorites (★ updates live) |
| Tab | Switch tabs (header focus, as in Config) |
| ← / → | Cycle effort level (only when focused model supports effort) |
| Enter | Select focused model → `onSelect(id, effort)` |
| Esc | Cancel |

**States:** loading (`Loading models from OpenRouter…`), error (clear message + retry hint
when fetch fails with no cache), and empty Favorites tab (hint:
`No favorites yet — press Space on any model in All models to add one`).

### 6.3 Favorites store (in `utils/config.ts`)

- New global config key: `openRouterFavorites: string[]` (model ids).
- Helpers: `getOpenRouterFavorites(): string[]`, `toggleOpenRouterFavorite(id: string): void`.
- Global scope: applies across all projects.

---

## 7. Wiring Into Surfaces

| Surface | Change |
|---------|--------|
| `/model` (no-arg) | `ModelPickerWrapper` (`commands/model/model.tsx`) renders `ModelBrowser` instead of `ModelPicker`. `onSelect` sets `mainLoopModel` to the OpenRouter id (existing flow). |
| Config "Model" row | Opens `ModelBrowser` as its submenu, same as `/model`. |
| `/model <name>`, `--model`, aliases | **Unchanged** resolution layer — still accepts any id/alias. |
| Agent creation wizard | **Remove** the model step; agents are created with no `model` field → defaults to `inherit`. Drop the now-unused `ModelSelector` usage from that flow. |
| `ModelPicker.tsx` | **Removed** once `/model`, Config, and the wizard no longer reference it. |

**Subagent model resolution** (`utils/model/agent.ts`, `getAgentModel`) is **untouched**: its
`inherit` path already resolves to the parent/main-loop model, so subagents transparently use
whatever OpenRouter model the user picked.

---

## 8. Reasoning Effort

### 8.1 Expanded effort ladder

Grow knightcode's `EffortLevel` union from `low|medium|high|max` to OpenCode's full,
ordered ladder:

```
none · minimal · low · medium · high · xhigh · max
```

Touched: `utils/effort.ts` (`EFFORT_LEVELS`), the settings Zod schema, AppState, the
`/effort` command, and the status-bar/spinner display — all extended to the new members.

### 8.2 `getSupportedEffortLevels(model): EffortLevel[]`

Single source of truth for what a model accepts. Ported (trimmed) from OpenCode's
`transform.ts` capability table. Evaluated in order:

1. **Not reasoning-capable** (`supported_parameters` lacks `reasoning`) → `[]`.
2. **GPT family (via OpenRouter)** → version-aware set ported from OpenCode's
   `openaiCompatibleReasoningEfforts` / `gpt5*ReasoningEfforts`:
   - `gpt-5.1` swaps `minimal` → `none`.
   - `gpt-5.2+` additionally accepts `xhigh`.
   - `-codex`, `-chat`, `-pro` variants get their specific lists.
3. **Claude / Gemini-3** → `none, minimal, low, medium, high, xhigh`.
4. **grok-3-mini** → `low, high` (documented set); other `grok` → handled by fallback.
5. **Everything else reasoning-capable** → **`low, medium, high`** (the generous default;
   absorbs OpenCode's deepseek/qwen/glm/kimi/minimax denylist into the safe default rather
   than hiding the selector).

`max` is never produced for OpenRouter models (Anthropic-native only).

### 8.3 Hard enforcement

- **UI gate:** `ModelBrowser` only cycles `getSupportedEffortLevels(focused)`.
- **Resolve chokepoint:** generalize the existing `resolveAppliedEffort()` clamp (today's
  `max → high`) so that any requested level **not** in the model's supported set is clamped
  **down to the nearest supported level ≤ requested** (e.g. `xhigh → high`, `minimal → low`),
  or dropped entirely when the set is empty. Because every request path resolves effort
  through this one function, an unsupported level cannot reach the wire.
- **Wire format:** sent as OpenRouter's `reasoning: { effort: <level> }`.

### 8.4 Capability functions to update

- `modelSupportsEffort(model)` → returns `getSupportedEffortLevels(model).length > 0` for
  OpenRouter ids (falls back to existing behavior otherwise).
- `modelSupportsMaxEffort(model)` → `false` for OpenRouter ids.

---

## 9. Data Flow: Selecting a Model

1. User opens `/model` → `ModelBrowser` mounts → `getOpenRouterModels()` (cache or fetch).
2. Browser shows Favorites/All tabs; user searches, navigates, optionally Space-favorites.
3. User adjusts effort (only offered levels selectable) and presses Enter.
4. `onSelect(id, effort)` sets `mainLoopModel = id` and persists effort (existing AppState /
   settings flow).
5. On the next request, `resolveAppliedEffort(id, effort)` clamps against
   `getSupportedEffortLevels(id)` and the client sends `model: id` +
   `reasoning: { effort }` (if any).

---

## 10. Verification Points (verify, do not assume)

1. **Model string flow:** Confirm a selected OpenRouter id round-trips as `mainLoopModel`
   to the OpenRouter client and is accepted (no Anthropic-only normalization mangles it).
2. **Effort wire mapping:** Confirm effort is emitted as `reasoning: { effort }` on the
   OpenRouter request and honored. If the existing effort→request plumbing only emits the
   Anthropic-style field, add the OpenRouter mapping. **This is the one item that may expand
   scope** — flag it during implementation rather than assuming it works.
3. **Catalog shape:** Confirm OpenRouter's `/api/v1/models` returns `supported_parameters`,
   `architecture.input_modalities`, `context_length`, and `pricing` as assumed.

---

## 11. Files Touched

**New:**
- `packages/cli/src/utils/model/openRouterModels.ts`
- `packages/cli/src/components/ModelBrowser.tsx`

**Edited:**
- `packages/cli/src/commands/model/model.tsx` — render `ModelBrowser`.
- `packages/cli/src/components/Settings/Config.tsx` — Model row opens `ModelBrowser`.
- `packages/cli/src/utils/config.ts` — favorites key + helpers.
- `packages/cli/src/utils/effort.ts` — expanded ladder + `getSupportedEffortLevels` +
  generalized clamp.
- Settings schema / AppState / `/effort` command / status-bar display — extend effort union.
- Agent creation wizard (`components/agents/new-agent-creation/...`) — remove model step.

**Removed:**
- `packages/cli/src/components/ModelPicker.tsx` (once all references migrate).

---

## 12. Open Risks

- **Effort wire plumbing** (Verification Point 2) is the most likely place to discover extra
  work; the rest is additive UI + a capability table.
- **Catalog size:** OpenRouter lists 300+ models; the search box + virtualized scroll
  (reused from Config) keep the list usable.
- **`EffortLevel` union expansion** ripples through several files; contained but broad —
  each `switch` over effort levels must handle the new members.
