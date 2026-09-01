# Model Adaptation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt request construction per model (sampling, reasoning enablement + budget, tool-schema sanitization, message normalization, context sizing, provider routing) so any OpenRouter model runs as well as it can in the KnightCode harness.

**Architecture:** A live OpenRouter capability catalog (Layer 1) plus a hand-curated quirks registry (Layer 2) merge into a memoized `ModelProfile` (Layer 3). Pure applier functions consume the profile and edit the request body / tool schemas / messages at three seams in `services/api/knightcode.ts`. The Anthropic path is preserved byte-identical, merely routed through the reasoning applier.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Bun test runner (`bun:test`), Anthropic SDK Beta Messages types, OpenRouter `/api/v1/models` + `/v1/messages`.

## Global Constraints

- Catalog source is **OpenRouter only** (`GET https://openrouter.ai/api/v1/models`). No models.dev or other catalogs.
- Scope is **OpenRouter-BYOK only**. No Bedrock/Vertex/Azure/Copilot provider code.
- Anthropic (`anthropic/*`) request shape MUST remain behavior-identical to today (adaptive thinking preserved; temperature omitted when thinking is on).
- All appliers are **pure and total**: never throw into the request path; unknown input degrades to a no-op.
- Never send a sampling/reasoning param the catalog marks unsupported for that model.
- Import specifiers use `.js` extensions (ESM). Tests import from `'bun:test'`. Run tests with `bun test <path>`.
- Escape hatch: `KNIGHTCODE_DISABLE_MODEL_PROFILE` truthy → appliers become no-ops (debug).

---

### Task 1: Extend the OpenRouter catalog (capabilities + boot warm)

Extend the existing catalog entry to carry the full `supported_parameters` set, the completion-token limit, and the provider/author slug, and add a non-blocking boot warm so the cache is populated without opening the model picker.

**Files:**
- Modify: `packages/cli/src/utils/model/openRouterModels.ts`
- Test: `packages/cli/src/utils/model/openRouterModels.catalog.test.ts`

**Interfaces:**
- Produces: `OpenRouterModel` extended with `supportedParameters: string[]`, `maxCompletionTokens?: number`, `authorSlug: string`. New functions `getModelSupportedParameters(id: string): Set<string>` and `warmModelCatalog(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/openRouterModels.catalog.test.ts
import { describe, expect, test } from 'bun:test'
import { getModelSupportedParameters } from './openRouterModels.js'

describe('catalog supported-parameters accessor', () => {
  test('returns an empty set for an unknown model (no crash)', () => {
    const params = getModelSupportedParameters('does/not-exist-xyz')
    expect(params instanceof Set).toBe(true)
    expect(params.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/openRouterModels.catalog.test.ts`
Expected: FAIL — `getModelSupportedParameters` is not exported.

- [ ] **Step 3: Extend the type and normalization, add accessors + warm**

In `openRouterModels.ts`, extend the `OpenRouterModel` type:

```ts
export type OpenRouterModel = {
  id: string
  name: string
  contextLength: number
  maxCompletionTokens?: number   // top_provider.max_completion_tokens
  authorSlug: string             // id.split('/')[0], e.g. "nvidia"
  pricing: { prompt: number; completion: number }
  inputModalities: string[]
  supportsTools: boolean
  supportsReasoning: boolean
  supportedParameters: string[]  // raw supported_parameters list
}
```

In the `.map((m: any) => …)` normalizer (the `return { … }` object), add:

```ts
      return {
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length || 0,
        maxCompletionTokens: m.top_provider?.max_completion_tokens ?? undefined,
        authorSlug: String(m.id || '').split('/')[0] || '',
        pricing: { prompt: promptPricing, completion: completionPricing },
        inputModalities,
        supportsTools: supportedParams.includes('tools'),
        supportsReasoning: supportedParams.includes('reasoning'),
        supportedParameters: Array.isArray(supportedParams) ? supportedParams : [],
      }
```

At the end of the file add the accessor and the boot warm:

```ts
/** Supported request parameters for a model (empty set if unknown). */
export function getModelSupportedParameters(id: string): Set<string> {
  return new Set(getOpenRouterModel(id)?.supportedParameters ?? [])
}

/**
 * Fire-and-forget catalog warm for startup. Populates the in-memory + disk
 * cache so context sizing and model profiles have real data without the user
 * opening the model picker. Never throws.
 */
export function warmModelCatalog(): void {
  void getOpenRouterModels().catch(() => {
    /* offline / no key — disk snapshot or defaults are used downstream */
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/openRouterModels.catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/openRouterModels.ts packages/cli/src/utils/model/openRouterModels.catalog.test.ts
git commit -m "feat(model): extend OpenRouter catalog with supported params + boot warm"
```

---

### Task 2: ModelProfile types

Define the shared types the whole subsystem speaks.

**Files:**
- Create: `packages/cli/src/utils/model/profile/types.ts`
- Test: `packages/cli/src/utils/model/profile/types.test.ts`

**Interfaces:**
- Produces: `Sampling`, `ReasoningStrategy`, `SchemaTransform`, `MessageTransform`, `ModelProfile`, and the constant `MIN_COMPLETION_FLOOR`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/types.test.ts
import { describe, expect, test } from 'bun:test'
import { MIN_COMPLETION_FLOOR } from './types.js'

describe('profile types', () => {
  test('MIN_COMPLETION_FLOOR is a positive integer', () => {
    expect(Number.isInteger(MIN_COMPLETION_FLOOR)).toBe(true)
    expect(MIN_COMPLETION_FLOOR).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the types module**

```ts
// packages/cli/src/utils/model/profile/types.ts

/** Reserve at least this many output tokens for the final answer when
 *  reasoning is enabled, so reasoning never starves the completion. */
export const MIN_COMPLETION_FLOOR = 4096

export type Sampling = {
  temperature?: number
  topP?: number
  topK?: number
}

/** How to ask THIS model to reason. */
export type ReasoningStrategy =
  | { kind: 'anthropic-adaptive' }
  | { kind: 'anthropic-budget'; budgetTokens: number }
  | { kind: 'openrouter-effort' }
  | { kind: 'enable-flag'; body: Record<string, unknown> }
  | { kind: 'none' }

/** Pure tool-schema rewrite (e.g. Gemini int→string enums). */
export type SchemaTransform = (schema: any) => any
/** Pure message-array rewrite (e.g. DeepSeek reasoning blocks). */
export type MessageTransform = (messages: any[]) => any[]

export type ModelProfile = {
  id: string
  // capability (from catalog; undefined when catalog is cold)
  contextLength?: number
  maxOutputTokens?: number
  supportsReasoning: boolean
  supportsTools: boolean
  supportedParameters: ReadonlySet<string>
  // quirks
  sampling: Sampling
  reasoning: ReasoningStrategy
  extraBody: Record<string, unknown>
  schemaTransforms: SchemaTransform[]
  messageTransforms: MessageTransform[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/types.ts packages/cli/src/utils/model/profile/types.test.ts
git commit -m "feat(model): add model-profile types"
```

---

### Task 3: Tool-schema transforms

Pure schema rewrites that make Claude-shaped JSON schemas acceptable to non-Claude models, plus the applier that runs a profile's transforms.

**Files:**
- Create: `packages/cli/src/utils/model/profile/appliers/schema.ts`
- Test: `packages/cli/src/utils/model/profile/appliers/schema.test.ts`

**Interfaces:**
- Consumes: `SchemaTransform`, `ModelProfile` (Task 2).
- Produces: `geminiEnumToString(schema)`, `moonshotStripRefSiblings(schema)`, `sanitizeToolSchema(schema, profile)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/appliers/schema.test.ts
import { describe, expect, test } from 'bun:test'
import { geminiEnumToString, moonshotStripRefSiblings } from './schema.js'

describe('geminiEnumToString', () => {
  test('converts integer enum values to strings and retypes to string', () => {
    const out = geminiEnumToString({
      type: 'object',
      properties: { level: { type: 'integer', enum: [1, 2, 3] } },
    })
    expect(out.properties.level.type).toBe('string')
    expect(out.properties.level.enum).toEqual(['1', '2', '3'])
  })
})

describe('moonshotStripRefSiblings', () => {
  test('drops sibling keywords next to $ref', () => {
    const out = moonshotStripRefSiblings({ $ref: '#/x', description: 'd', title: 't' })
    expect(out).toEqual({ $ref: '#/x' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/appliers/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transforms + applier**

```ts
// packages/cli/src/utils/model/profile/appliers/schema.ts
import type { ModelProfile, SchemaTransform } from '../types.js'

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Gemini rejects integer enums and integer-typed enum nodes. */
export const geminiEnumToString: SchemaTransform = (schema: any): any => {
  if (Array.isArray(schema)) return schema.map(geminiEnumToString)
  if (!isObj(schema)) return schema
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'enum' && Array.isArray(v)) {
      out.enum = v.map(x => String(x))
      if (schema.type === 'integer' || schema.type === 'number') out.type = 'string'
    } else if (isObj(v) || Array.isArray(v)) {
      out[k] = geminiEnumToString(v)
    } else {
      out[k] = v
    }
  }
  if (out.enum && (out.type === 'integer' || out.type === 'number')) out.type = 'string'
  return out
}

/** Moonshot/Kimi expand $ref before validation and reject sibling keywords. */
export const moonshotStripRefSiblings: SchemaTransform = (schema: any): any => {
  if (Array.isArray(schema)) return schema.map(moonshotStripRefSiblings)
  if (!isObj(schema)) return schema
  if ('$ref' in schema && typeof schema.$ref === 'string') return { $ref: schema.$ref }
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(schema)) out[k] = moonshotStripRefSiblings(v)
  return out
}

/** Run every schema transform the profile carries. Total: returns input on error. */
export function sanitizeToolSchema(schema: any, profile: ModelProfile): any {
  try {
    return profile.schemaTransforms.reduce((acc, t) => t(acc), schema)
  } catch {
    return schema
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/appliers/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/appliers/schema.ts packages/cli/src/utils/model/profile/appliers/schema.test.ts
git commit -m "feat(model): tool-schema transforms (gemini enums, moonshot \$ref)"
```

---

### Task 4: Message transforms

Pure message-array rewrites for models with format requirements, plus the applier.

**Files:**
- Create: `packages/cli/src/utils/model/profile/appliers/messages.ts`
- Test: `packages/cli/src/utils/model/profile/appliers/messages.test.ts`

**Interfaces:**
- Consumes: `MessageTransform`, `ModelProfile`.
- Produces: `deepseekEnsureReasoning(msgs)`, `mistralScrubToolIds(msgs)`, `normalizeMessagesForModel(msgs, profile)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/appliers/messages.test.ts
import { describe, expect, test } from 'bun:test'
import { deepseekEnsureReasoning, mistralScrubToolIds } from './messages.js'

describe('deepseekEnsureReasoning', () => {
  test('adds an empty reasoning block to assistant array messages lacking one', () => {
    const out = deepseekEnsureReasoning([
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ])
    const parts = out[0].content
    expect(parts.some((p: any) => p.type === 'thinking' || p.type === 'reasoning')).toBe(true)
  })
})

describe('mistralScrubToolIds', () => {
  test('truncates tool_use ids to 9 alphanumeric chars', () => {
    const out = mistralScrubToolIds([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_ABC-123-xyz', name: 'x', input: {} }] },
    ])
    expect(out[0].content[0].id).toMatch(/^[a-zA-Z0-9]{9}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/appliers/messages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transforms + applier**

```ts
// packages/cli/src/utils/model/profile/appliers/messages.ts
import type { MessageTransform, ModelProfile } from '../types.js'

/** DeepSeek requires every assistant message to carry a reasoning/thinking block. */
export const deepseekEnsureReasoning: MessageTransform = (msgs: any[]): any[] =>
  msgs.map(msg => {
    if (msg?.role !== 'assistant') return msg
    if (Array.isArray(msg.content)) {
      if (msg.content.some((p: any) => p.type === 'thinking' || p.type === 'reasoning')) return msg
      return { ...msg, content: [...msg.content, { type: 'thinking', thinking: '', signature: '' }] }
    }
    return {
      ...msg,
      content: [
        ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
        { type: 'thinking', thinking: '', signature: '' },
      ],
    }
  })

const scrub9 = (id: string) =>
  id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 9).padEnd(9, '0')

/** Mistral/Devstral require tool ids of exactly 9 alphanumeric chars, matched
 *  across the assistant tool_use and the corresponding tool_result. */
export const mistralScrubToolIds: MessageTransform = (msgs: any[]): any[] =>
  msgs.map(msg => {
    if (!Array.isArray(msg?.content)) return msg
    return {
      ...msg,
      content: msg.content.map((part: any) => {
        if (part?.type === 'tool_use' && typeof part.id === 'string') {
          return { ...part, id: scrub9(part.id) }
        }
        if (part?.type === 'tool_result' && typeof part.tool_use_id === 'string') {
          return { ...part, tool_use_id: scrub9(part.tool_use_id) }
        }
        return part
      }),
    }
  })

/** Run every message transform the profile carries. Total: returns input on error. */
export function normalizeMessagesForModel(msgs: any[], profile: ModelProfile): any[] {
  try {
    return profile.messageTransforms.reduce((acc, t) => t(acc), msgs)
  } catch {
    return msgs
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/appliers/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/appliers/messages.ts packages/cli/src/utils/model/profile/appliers/messages.test.ts
git commit -m "feat(model): message transforms (deepseek reasoning, mistral tool ids)"
```

---

### Task 5: Quirks registry

The hand-curated rules matched by model id, contributing partial profile overrides. Depends on the transforms from Tasks 3 & 4.

**Files:**
- Create: `packages/cli/src/utils/model/profile/quirks.ts`
- Test: `packages/cli/src/utils/model/profile/quirks.test.ts`

**Interfaces:**
- Consumes: schema transforms (Task 3), message transforms (Task 4), `Sampling`/`ReasoningStrategy`/`SchemaTransform`/`MessageTransform` (Task 2).
- Produces: `type QuirkOverride`, `matchQuirks(id: string): QuirkOverride` (merged result of all matching rules).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/quirks.test.ts
import { describe, expect, test } from 'bun:test'
import { matchQuirks } from './quirks.js'

describe('matchQuirks', () => {
  test('qwen gets temperature 0.55', () => {
    expect(matchQuirks('qwen/qwen3-coder:free').sampling?.temperature).toBe(0.55)
  })
  test('gemini gets a schema transform', () => {
    expect((matchQuirks('google/gemini-2.5-flash').schemaTransforms ?? []).length).toBeGreaterThan(0)
  })
  test('an unmatched model yields an empty override', () => {
    const q = matchQuirks('acme/unknown-1')
    expect(q.sampling).toBeUndefined()
    expect(q.reasoning).toBeUndefined()
    expect(q.schemaTransforms ?? []).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/quirks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

```ts
// packages/cli/src/utils/model/profile/quirks.ts
import type {
  MessageTransform,
  ReasoningStrategy,
  Sampling,
  SchemaTransform,
} from './types.js'
import { geminiEnumToString, moonshotStripRefSiblings } from './appliers/schema.js'
import { deepseekEnsureReasoning, mistralScrubToolIds } from './appliers/messages.js'

export type QuirkOverride = {
  sampling?: Sampling
  reasoning?: ReasoningStrategy
  extraBody?: Record<string, unknown>
  schemaTransforms?: SchemaTransform[]
  messageTransforms?: MessageTransform[]
}

type QuirkRule = { match: (id: string) => boolean; override: QuirkOverride }

const has = (s: string) => (id: string) => id.toLowerCase().includes(s)

// Rules apply in order; later rules merge over earlier ones. Keep specific
// rules after general ones. Sampling values ported from opencode transform.ts.
const RULES: QuirkRule[] = [
  { match: has('qwen'), override: { sampling: { temperature: 0.55, topP: 1 } } },
  { match: has('minimax'), override: { sampling: { topP: 0.95, topK: 20 } } },
  { match: has('glm'), override: { sampling: { temperature: 1.0 } } },
  {
    match: has('kimi'),
    override: { sampling: { temperature: 0.6 }, extraBody: { chat_template_args: { enable_thinking: true } } },
  },
  {
    match: has('gemini'),
    override: { sampling: { topP: 0.95, topK: 64 }, schemaTransforms: [geminiEnumToString] },
  },
  { match: has('moonshot'), override: { schemaTransforms: [moonshotStripRefSiblings] } },
  { match: has('deepseek'), override: { messageTransforms: [deepseekEnsureReasoning] } },
  { match: (id) => /mistral|devstral/i.test(id), override: { messageTransforms: [mistralScrubToolIds] } },
]

/** Merge all matching rules into one override (later rules win on scalars; arrays concat). */
export function matchQuirks(id: string): QuirkOverride {
  const merged: QuirkOverride = {}
  for (const rule of RULES) {
    if (!rule.match(id)) continue
    const o = rule.override
    if (o.sampling) merged.sampling = { ...merged.sampling, ...o.sampling }
    if (o.reasoning) merged.reasoning = o.reasoning
    if (o.extraBody) merged.extraBody = { ...merged.extraBody, ...o.extraBody }
    if (o.schemaTransforms) merged.schemaTransforms = [...(merged.schemaTransforms ?? []), ...o.schemaTransforms]
    if (o.messageTransforms) merged.messageTransforms = [...(merged.messageTransforms ?? []), ...o.messageTransforms]
  }
  return merged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/quirks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/quirks.ts packages/cli/src/utils/model/profile/quirks.test.ts
git commit -m "feat(model): per-model quirks registry"
```

---

### Task 6: Profile resolver

Merge catalog (Task 1) + quirks (Task 5) into a memoized `ModelProfile`.

**Files:**
- Create: `packages/cli/src/utils/model/profile/profile.ts`
- Test: `packages/cli/src/utils/model/profile/profile.test.ts`

**Interfaces:**
- Consumes: `getOpenRouterModel`, `getModelSupportedParameters` (Task 1); `matchQuirks` (Task 5); `ModelProfile` (Task 2).
- Produces: `resolveModelProfile(id: string): ModelProfile`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/profile.test.ts
import { describe, expect, test } from 'bun:test'
import { resolveModelProfile } from './profile.js'

describe('resolveModelProfile', () => {
  test('folds quirk sampling into the profile', () => {
    expect(resolveModelProfile('qwen/qwen3-coder:free').sampling.temperature).toBe(0.55)
  })
  test('unknown model yields safe defaults (no reasoning, empty sampling)', () => {
    const p = resolveModelProfile('acme/unknown-1')
    expect(p.reasoning.kind).toBe('none')
    expect(p.sampling).toEqual({})
    expect(p.supportsReasoning).toBe(false)
  })
  test('anthropic models resolve to adaptive reasoning', () => {
    expect(resolveModelProfile('anthropic/claude-sonnet-4.6').reasoning.kind).toBe('anthropic-adaptive')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```ts
// packages/cli/src/utils/model/profile/profile.ts
import { getModelSupportedParameters, getOpenRouterModel } from '../openRouterModels.js'
import { matchQuirks } from './quirks.js'
import type { ModelProfile, ReasoningStrategy } from './types.js'

const cache = new Map<string, ModelProfile>()

/** Default reasoning strategy from catalog capability when no quirk overrides it. */
function defaultReasoning(id: string, supportsReasoning: boolean): ReasoningStrategy {
  const lower = id.toLowerCase()
  if (lower.startsWith('anthropic/') || lower.includes('claude')) {
    return { kind: 'anthropic-adaptive' }
  }
  if (supportsReasoning) return { kind: 'openrouter-effort' }
  return { kind: 'none' }
}

export function resolveModelProfile(id: string): ModelProfile {
  const cached = cache.get(id)
  if (cached) return cached

  const entry = getOpenRouterModel(id)
  const supportedParameters = getModelSupportedParameters(id)
  const supportsReasoning = entry?.supportsReasoning ?? false
  const quirks = matchQuirks(id)

  const profile: ModelProfile = {
    id,
    contextLength: entry?.contextLength || undefined,
    maxOutputTokens: entry?.maxCompletionTokens,
    supportsReasoning,
    supportsTools: entry?.supportsTools ?? true,
    supportedParameters,
    sampling: quirks.sampling ?? {},
    reasoning: quirks.reasoning ?? defaultReasoning(id, supportsReasoning),
    extraBody: quirks.extraBody ?? {},
    schemaTransforms: quirks.schemaTransforms ?? [],
    messageTransforms: quirks.messageTransforms ?? [],
  }
  cache.set(id, profile)
  return profile
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/profile.ts packages/cli/src/utils/model/profile/profile.test.ts
git commit -m "feat(model): resolveModelProfile (catalog + quirks merge)"
```

---

### Task 7: Sampling applier

Set temperature/top_p/top_k on the body — but only params the catalog marks supported.

**Files:**
- Create: `packages/cli/src/utils/model/profile/appliers/sampling.ts`
- Test: `packages/cli/src/utils/model/profile/appliers/sampling.test.ts`

**Interfaces:**
- Consumes: `ModelProfile` (Task 2).
- Produces: `applySampling(body: Record<string, any>, profile: ModelProfile): Record<string, any>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/appliers/sampling.test.ts
import { describe, expect, test } from 'bun:test'
import { applySampling } from './sampling.js'
import type { ModelProfile } from '../types.js'

const base = (over: Partial<ModelProfile>): ModelProfile => ({
  id: 'x', supportsReasoning: false, supportsTools: true,
  supportedParameters: new Set(['temperature', 'top_p', 'top_k']),
  sampling: {}, reasoning: { kind: 'none' }, extraBody: {},
  schemaTransforms: [], messageTransforms: [], ...over,
})

describe('applySampling', () => {
  test('sets supported sampling params', () => {
    const out = applySampling({}, base({ sampling: { temperature: 0.55, topP: 1, topK: 40 } }))
    expect(out.temperature).toBe(0.55)
    expect(out.top_p).toBe(1)
    expect(out.top_k).toBe(40)
  })
  test('omits a param the catalog does not support', () => {
    const out = applySampling({}, base({
      sampling: { temperature: 0.5, topK: 40 },
      supportedParameters: new Set(['temperature']),
    }))
    expect(out.temperature).toBe(0.5)
    expect('top_k' in out).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/appliers/sampling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the applier**

```ts
// packages/cli/src/utils/model/profile/appliers/sampling.ts
import type { ModelProfile } from '../types.js'

const supports = (p: ModelProfile, name: string) =>
  p.supportedParameters.size === 0 || p.supportedParameters.has(name)

/** Apply per-model sampling. Only sets params the catalog marks supported.
 *  When supportedParameters is empty (cold catalog) it trusts the quirk. */
export function applySampling(
  body: Record<string, any>,
  profile: ModelProfile,
): Record<string, any> {
  const { temperature, topP, topK } = profile.sampling
  if (temperature !== undefined && supports(profile, 'temperature')) body.temperature = temperature
  if (topP !== undefined && supports(profile, 'top_p')) body.top_p = topP
  if (topK !== undefined && supports(profile, 'top_k')) body.top_k = topK
  return body
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/appliers/sampling.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/appliers/sampling.ts packages/cli/src/utils/model/profile/appliers/sampling.test.ts
git commit -m "feat(model): sampling applier (catalog-gated temp/top_p/top_k)"
```

---

### Task 8: Reasoning applier

Choose the correct reasoning signal for the model and enforce the answer-token floor.

**Files:**
- Create: `packages/cli/src/utils/model/profile/appliers/reasoning.ts`
- Test: `packages/cli/src/utils/model/profile/appliers/reasoning.test.ts`

**Interfaces:**
- Consumes: `ModelProfile`, `MIN_COMPLETION_FLOOR` (Task 2).
- Produces: `applyReasoning(body, profile, ctx): Record<string, any>` where `ctx = { effort?: string; hasThinking: boolean; budgetTokens: number; maxOutputTokens: number }`. The function sets exactly one of `body.thinking` / `body.reasoning` (or merges an enable-flag) and may raise `body.max_tokens` to the floor.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/appliers/reasoning.test.ts
import { describe, expect, test } from 'bun:test'
import { applyReasoning } from './reasoning.js'
import { MIN_COMPLETION_FLOOR } from '../types.js'
import type { ModelProfile } from '../types.js'

const base = (over: Partial<ModelProfile>): ModelProfile => ({
  id: 'x', supportsReasoning: true, supportsTools: true,
  supportedParameters: new Set(['reasoning']),
  sampling: {}, reasoning: { kind: 'none' }, extraBody: {},
  schemaTransforms: [], messageTransforms: [], ...over,
})
const ctx = (over: Partial<{ effort: string; hasThinking: boolean; budgetTokens: number; maxOutputTokens: number }> = {}) =>
  ({ hasThinking: true, budgetTokens: 8000, maxOutputTokens: 32000, ...over })

describe('applyReasoning', () => {
  test('anthropic-adaptive sets thinking adaptive, no reasoning field', () => {
    const out = applyReasoning({}, base({ reasoning: { kind: 'anthropic-adaptive' } }), ctx())
    expect(out.thinking).toEqual({ type: 'adaptive' })
    expect('reasoning' in out).toBe(false)
  })
  test('openrouter-effort sets reasoning.effort and raises max_tokens to the floor', () => {
    const out = applyReasoning({ max_tokens: 1000 }, base({ reasoning: { kind: 'openrouter-effort' } }), ctx({ effort: 'high', maxOutputTokens: 32000 }))
    expect(out.reasoning).toEqual({ effort: 'high' })
    expect(out.max_tokens).toBe(MIN_COMPLETION_FLOOR)
  })
  test('none leaves the body untouched', () => {
    const out = applyReasoning({ max_tokens: 500 }, base({ reasoning: { kind: 'none' } }), ctx())
    expect('thinking' in out).toBe(false)
    expect('reasoning' in out).toBe(false)
    expect(out.max_tokens).toBe(500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/appliers/reasoning.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the applier**

```ts
// packages/cli/src/utils/model/profile/appliers/reasoning.ts
import { MIN_COMPLETION_FLOOR, type ModelProfile } from '../types.js'

type Ctx = {
  effort?: string
  hasThinking: boolean
  budgetTokens: number
  maxOutputTokens: number
}

/** Ensure max_tokens leaves room for a real answer when reasoning is on. */
function ensureAnswerFloor(body: Record<string, any>, maxOutputTokens: number) {
  const floor = Math.min(MIN_COMPLETION_FLOOR, maxOutputTokens)
  const current = typeof body.max_tokens === 'number' ? body.max_tokens : 0
  if (current < floor) body.max_tokens = floor
}

/**
 * Set the reasoning signal appropriate to the model. Sets exactly one of
 * `thinking` (Anthropic) / `reasoning` (OpenRouter) / an enable-flag merge.
 * No-op when reasoning is disabled for this turn or unsupported.
 */
export function applyReasoning(
  body: Record<string, any>,
  profile: ModelProfile,
  ctx: Ctx,
): Record<string, any> {
  if (!ctx.hasThinking) return body
  const r = profile.reasoning
  switch (r.kind) {
    case 'anthropic-adaptive':
      body.thinking = { type: 'adaptive' }
      return body
    case 'anthropic-budget':
      body.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(ctx.maxOutputTokens - 1, r.budgetTokens),
      }
      return body
    case 'openrouter-effort':
      body.reasoning = { effort: ctx.effort ?? 'medium' }
      ensureAnswerFloor(body, ctx.maxOutputTokens)
      return body
    case 'enable-flag':
      Object.assign(body, r.body)
      ensureAnswerFloor(body, ctx.maxOutputTokens)
      return body
    case 'none':
    default:
      return body
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/appliers/reasoning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/appliers/reasoning.ts packages/cli/src/utils/model/profile/appliers/reasoning.test.ts
git commit -m "feat(model): reasoning applier with answer-token floor"
```

---

### Task 9: Provider-routing applier

Add the OpenRouter `provider` object so the gateway only routes to backends that honor the params we send.

**Files:**
- Create: `packages/cli/src/utils/model/profile/appliers/providerRouting.ts`
- Test: `packages/cli/src/utils/model/profile/appliers/providerRouting.test.ts`

**Interfaces:**
- Consumes: `ModelProfile`.
- Produces: `applyProviderRouting(body, profile): Record<string, any>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/appliers/providerRouting.test.ts
import { describe, expect, test } from 'bun:test'
import { applyProviderRouting } from './providerRouting.js'
import type { ModelProfile } from '../types.js'

const base = (over: Partial<ModelProfile> = {}): ModelProfile => ({
  id: 'x', supportsReasoning: false, supportsTools: true,
  supportedParameters: new Set(), sampling: {}, reasoning: { kind: 'none' },
  extraBody: {}, schemaTransforms: [], messageTransforms: [], ...over,
})

describe('applyProviderRouting', () => {
  test('sets require_parameters so backends must honor sent params', () => {
    const out = applyProviderRouting({}, base())
    expect(out.provider).toEqual({ require_parameters: true })
  })
  test('a profile-supplied provider override wins', () => {
    const out = applyProviderRouting({}, base({ extraBody: { provider: { order: ['Anthropic'], require_parameters: true } } }))
    expect(out.provider).toEqual({ order: ['Anthropic'], require_parameters: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/appliers/providerRouting.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the applier**

```ts
// packages/cli/src/utils/model/profile/appliers/providerRouting.ts
import type { ModelProfile } from '../types.js'

/**
 * Pin OpenRouter routing. Default policy: require_parameters:true so OR only
 * routes to backends that support the params we send (e.g. reasoning). A quirk
 * may supply a richer `provider` object via extraBody, which takes precedence.
 */
export function applyProviderRouting(
  body: Record<string, any>,
  profile: ModelProfile,
): Record<string, any> {
  const override = profile.extraBody.provider
  if (override && typeof override === 'object') {
    body.provider = override
    return body
  }
  body.provider = { require_parameters: true }
  return body
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/appliers/providerRouting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/appliers/providerRouting.ts packages/cli/src/utils/model/profile/appliers/providerRouting.test.ts
git commit -m "feat(model): provider-routing applier (require_parameters)"
```

---

### Task 10: Public barrel + extraBody merge helper

A single import surface for the subsystem, plus a helper that merges a profile's non-routing `extraBody` (e.g. `chat_template_args`) into a body.

**Files:**
- Create: `packages/cli/src/utils/model/profile/index.ts`
- Test: `packages/cli/src/utils/model/profile/index.test.ts`

**Interfaces:**
- Consumes: all Task 2–9 exports.
- Produces: re-exports `resolveModelProfile`, `applySampling`, `applyReasoning`, `applyProviderRouting`, `sanitizeToolSchema`, `normalizeMessagesForModel`, types; and `applyExtraBody(body, profile)` (merges extraBody except `provider`, which routing owns).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/model/profile/index.test.ts
import { describe, expect, test } from 'bun:test'
import { applyExtraBody, resolveModelProfile } from './index.js'

describe('profile barrel', () => {
  test('re-exports resolveModelProfile', () => {
    expect(typeof resolveModelProfile).toBe('function')
  })
  test('applyExtraBody merges extraBody but not provider', () => {
    const profile = { ...resolveModelProfile('kimi/k2'), extraBody: { chat_template_args: { enable_thinking: true }, provider: { x: 1 } } }
    const out = applyExtraBody({}, profile as any)
    expect(out.chat_template_args).toEqual({ enable_thinking: true })
    expect('provider' in out).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/utils/model/profile/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the barrel**

```ts
// packages/cli/src/utils/model/profile/index.ts
import type { ModelProfile } from './types.js'

export type {
  ModelProfile,
  Sampling,
  ReasoningStrategy,
  SchemaTransform,
  MessageTransform,
} from './types.js'
export { MIN_COMPLETION_FLOOR } from './types.js'
export { resolveModelProfile } from './profile.js'
export { applySampling } from './appliers/sampling.js'
export { applyReasoning } from './appliers/reasoning.js'
export { applyProviderRouting } from './appliers/providerRouting.js'
export { sanitizeToolSchema } from './appliers/schema.js'
export { normalizeMessagesForModel } from './appliers/messages.js'

/** Merge profile.extraBody into the body, except `provider` (routing owns it). */
export function applyExtraBody(
  body: Record<string, any>,
  profile: ModelProfile,
): Record<string, any> {
  for (const [k, v] of Object.entries(profile.extraBody)) {
    if (k === 'provider') continue
    body[k] = v
  }
  return body
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/utils/model/profile/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/model/profile/index.ts packages/cli/src/utils/model/profile/index.test.ts
git commit -m "feat(model): profile barrel + extraBody merge helper"
```

---

### Task 11: Default effort for OpenRouter reasoning models

Make `getDefaultEffortForModel` return a sensible effort for OpenRouter reasoning-capable models so the reasoning applier has a value instead of `undefined`.

**Files:**
- Modify: `packages/cli/src/utils/effort.ts:464-493` (`getDefaultEffortForModel`)
- Test: `packages/cli/src/utils/effort.profile.test.ts`

**Interfaces:**
- Consumes: `getOpenRouterModel` (Task 1).
- Produces: extended `getDefaultEffortForModel` behavior (signature unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/utils/effort.profile.test.ts
import { describe, expect, test } from 'bun:test'
import { getDefaultEffortForModel } from './effort.js'

describe('getDefaultEffortForModel for OpenRouter reasoning models', () => {
  test('returns undefined for a plain non-reasoning slug (unchanged behavior)', () => {
    // qwen3-coder is not reasoning-capable; with a cold catalog it stays undefined.
    expect(getDefaultEffortForModel('qwen/qwen3-coder:free')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test packages/cli/src/utils/effort.profile.test.ts`
Expected: PASS already (documents current behavior). This test guards the non-regression of the `undefined` default for non-reasoning models. Proceed to add the new branch.

- [ ] **Step 3: Add the OpenRouter reasoning branch**

In `effort.ts`, add this import near the other model imports at the top of the file:

```ts
import { getOpenRouterModel } from './model/openRouterModels.js'
```

In `getDefaultEffortForModel`, immediately before the final `return undefined`, insert:

```ts
  // OpenRouter reasoning-capable models default to 'medium' so the reasoning
  // applier sends a concrete effort instead of nothing (BYOK has no 1P default
  // resolution). Slug contains a vendor prefix; catalog says if it reasons.
  if (model.includes('/') && getOpenRouterModel(model)?.supportsReasoning) {
    return 'medium'
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/cli/src/utils/effort.profile.test.ts packages/cli/src/utils/effort.test.ts`
Expected: PASS (new branch only fires for reasoning-capable catalog entries; cold catalog leaves the non-reasoning test untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/effort.ts packages/cli/src/utils/effort.profile.test.ts
git commit -m "feat(model): default 'medium' effort for OpenRouter reasoning models"
```

---

### Task 12: Wire appliers into the request path + boot warm

Integrate the subsystem at the three seams in `knightcode.ts`, and warm the catalog at startup. Guard everything behind `KNIGHTCODE_DISABLE_MODEL_PROFILE`.

**Files:**
- Modify: `packages/cli/src/services/api/knightcode.ts` (toolSchemas build ~1243; message normalization ~1274; `paramsFromContext` return ~1701-1730)
- Modify: `packages/cli/src/bootstrap/state.ts` (call `warmModelCatalog()` once at startup; place next to existing one-time init)
- Test: `packages/cli/src/services/api/modelProfileWiring.test.ts`

**Interfaces:**
- Consumes: `resolveModelProfile`, `applySampling`, `applyReasoning`, `applyProviderRouting`, `applyExtraBody`, `sanitizeToolSchema`, `normalizeMessagesForModel` (Task 10); `warmModelCatalog` (Task 1).
- Produces: an exported pure helper `applyModelProfileToBody(body, modelId, ctx)` (so it is unit-testable without constructing a full query).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/services/api/modelProfileWiring.test.ts
import { describe, expect, test } from 'bun:test'
import { applyModelProfileToBody } from './modelProfile.js'

describe('applyModelProfileToBody', () => {
  test('qwen body gets temperature 0.55 and provider routing', () => {
    const out = applyModelProfileToBody({ max_tokens: 8000 }, 'qwen/qwen3-coder:free', {
      effort: undefined, hasThinking: true, budgetTokens: 8000, maxOutputTokens: 32000,
    })
    expect(out.temperature).toBe(0.55)
    expect(out.provider).toEqual({ require_parameters: true })
  })
  test('disabled via env is a no-op', () => {
    process.env.KNIGHTCODE_DISABLE_MODEL_PROFILE = '1'
    const out = applyModelProfileToBody({ max_tokens: 8000 }, 'qwen/qwen3-coder:free', {
      effort: undefined, hasThinking: true, budgetTokens: 8000, maxOutputTokens: 32000,
    })
    delete process.env.KNIGHTCODE_DISABLE_MODEL_PROFILE
    expect('temperature' in out).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/services/api/modelProfileWiring.test.ts`
Expected: FAIL — `./modelProfile.js` not found.

- [ ] **Step 3: Create the body-level integration helper**

```ts
// packages/cli/src/services/api/modelProfile.ts
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  applyExtraBody,
  applyProviderRouting,
  applyReasoning,
  applySampling,
  resolveModelProfile,
} from '../../utils/model/profile/index.js'

export type ReasoningCtx = {
  effort?: string
  hasThinking: boolean
  budgetTokens: number
  maxOutputTokens: number
}

/** Apply sampling + reasoning + extraBody + provider routing for a model.
 *  Pure; respects the KNIGHTCODE_DISABLE_MODEL_PROFILE escape hatch. */
export function applyModelProfileToBody(
  body: Record<string, any>,
  modelId: string,
  ctx: ReasoningCtx,
): Record<string, any> {
  if (isEnvTruthy(process.env.KNIGHTCODE_DISABLE_MODEL_PROFILE)) return body
  const profile = resolveModelProfile(modelId)
  applySampling(body, profile)
  applyReasoning(body, profile, ctx)
  applyExtraBody(body, profile)
  applyProviderRouting(body, profile)
  return body
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/services/api/modelProfileWiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the body helper into `paramsFromContext`**

In `knightcode.ts`, the current block computes `temperature` and `thinking` inline. Replace the construction so the profile owns sampling/reasoning. Specifically:

5a. Delete the inline `thinking` block (lines ~1598-1632) and the inline `temperature` const (lines ~1693-1697) **for non-Anthropic models**, keeping Anthropic behavior via the profile (which resolves anthropic ids to `anthropic-adaptive` / `anthropic-budget`). Concretely, keep the existing `hasThinking` computation, but compute the request reasoning/sampling by calling the helper on the assembled body just before `return`:

Replace the `return { … }` object's `thinking` and `temperature` lines with a post-pass. After building the object literal into a local `const requestBody = { …existing fields except thinking/temperature… }`, add:

```ts
    const requestBody: Record<string, any> = {
      model: normalizeModelStringForAPI(options.model),
      messages: addCacheBreakpoints(
        messagesForAPI, enablePromptCaching, options.querySource,
        useCachedMC, consumedCacheEdits, consumedPinnedEdits, options.skipCacheWrite,
      ),
      system,
      tools: allTools,
      tool_choice: options.toolChoice,
      ...(useBetas && { betas: betasParams }),
      metadata: getAPIMetadata(),
      max_tokens: maxOutputTokens,
      ...(contextManagement && useBetas &&
        betasParams.includes(CONTEXT_MANAGEMENT_BETA_HEADER) && { context_management: contextManagement }),
      ...extraBodyParams,
      ...(Object.keys(outputConfig).length > 0 && { output_config: outputConfig }),
      ...(speed !== undefined && { speed }),
    }

    applyModelProfileToBody(requestBody, options.model, {
      effort: typeof effort === 'string' ? effort : undefined,
      hasThinking,
      budgetTokens: getMaxThinkingTokensForModel(options.model),
      maxOutputTokens,
    })

    lastRequestBetas = betasParams
    return requestBody
```

Add the import at the top of `knightcode.ts`:

```ts
import { applyModelProfileToBody } from './modelProfile.js'
```

Note: `getMaxThinkingTokensForModel` is already imported in `knightcode.ts`. The Anthropic `configureEffortParams`/`output_config.effort` path is unchanged; the profile sets `thinking` for Anthropic exactly as before (adaptive), so 1P requests stay behavior-identical.

5b. Wire schema sanitization at the `toolSchemas` build (~line 1243). After `const toolSchemas = await Promise.all(...)`, add:

```ts
    const profileForSchemas = resolveModelProfile(options.model)
    const sanitizedToolSchemas = toolSchemas.map(s => sanitizeToolSchema(s, profileForSchemas))
```

and use `sanitizedToolSchemas` where `toolSchemas` was spread into `allTools` (`const allTools = [...sanitizedToolSchemas, ...extraToolSchemas]`).

5c. Wire message normalization. After the existing `messagesForAPI = ensureToolResultPairing(messagesForAPI)` line (~1309), add:

```ts
    messagesForAPI = normalizeMessagesForModel(
      messagesForAPI,
      resolveModelProfile(options.model),
    ) as typeof messagesForAPI
```

Add imports at the top of `knightcode.ts`:

```ts
import { resolveModelProfile } from '../../utils/model/profile/index.js'
import { normalizeMessagesForModel, sanitizeToolSchema } from '../../utils/model/profile/index.js'
```

5d. In `bootstrap/state.ts`, import and call the warm next to existing startup init:

```ts
import { warmModelCatalog } from '../utils/model/openRouterModels.js'
// …in the existing one-time bootstrap init function body:
warmModelCatalog()
```

- [ ] **Step 6: Run the full model + api test suites**

Run: `bun test packages/cli/src/utils/model packages/cli/src/services/api`
Expected: PASS. Pay special attention to existing `knightcode.ts` tests — Anthropic request shape must be unchanged.

- [ ] **Step 7: Type-check and commit**

Run: `bunx tsc -p packages/cli --noEmit` (expected: no new errors)

```bash
git add packages/cli/src/services/api/knightcode.ts packages/cli/src/services/api/modelProfile.ts packages/cli/src/services/api/modelProfileWiring.test.ts packages/cli/src/bootstrap/state.ts
git commit -m "feat(model): wire model-profile appliers into request path + boot warm"
```

---

### Task 13: Live contract test for favourite models (opt-in)

A regression guard that sends a tiny real request to each `openRouterFavorites` model and asserts the request shape is accepted and (when reasoning is expected) a non-empty answer comes back. Gated behind an env var so it never runs in normal CI.

**Files:**
- Create: `packages/cli/src/utils/model/profile/contract.live.test.ts`

**Interfaces:**
- Consumes: `resolveModelProfile`, `applyModelProfileToBody` (Tasks 6/12); `OPENROUTER_API_KEY` from env.

- [ ] **Step 1: Write the gated live test**

```ts
// packages/cli/src/utils/model/profile/contract.live.test.ts
import { describe, expect, test } from 'bun:test'
import { applyModelProfileToBody } from '../../../services/api/modelProfile.js'

const RUN = process.env.KNIGHTCODE_RUN_LIVE_CONTRACT === '1'
const KEY = process.env.OPENROUTER_API_KEY
const FAVORITES = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'poolside/laguna-xs.2:free',
  'qwen/qwen3-coder:free',
]

describe.if(RUN && !!KEY)('live contract: favourite models accept our request shape', () => {
  for (const model of FAVORITES) {
    test(`${model} returns a non-empty answer`, async () => {
      const body = applyModelProfileToBody(
        { model, max_tokens: 512, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] },
        model,
        { effort: 'low', hasThinking: true, budgetTokens: 2000, maxOutputTokens: 512 },
      )
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-Title': 'KnightCode' },
        body: JSON.stringify(body),
      })
      const json: any = await res.json().catch(() => null)
      expect(res.status).toBe(200)
      const content = json?.choices?.[0]?.message?.content ?? ''
      expect(content.length).toBeGreaterThan(0)
    }, 60000)
  }
})
```

- [ ] **Step 2: Run it locally (opt-in) to confirm it works**

Run: `KNIGHTCODE_RUN_LIVE_CONTRACT=1 bun test packages/cli/src/utils/model/profile/contract.live.test.ts`
Expected: each available favourite returns a non-empty answer; rate-limited (429) models will fail and surface exactly which favourites are unreliable (an intentional signal — note it; do not silently pass).

- [ ] **Step 3: Confirm it is skipped by default**

Run: `bun test packages/cli/src/utils/model/profile/contract.live.test.ts`
Expected: all tests skipped (the `describe.if` guard is false without the env var).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/utils/model/profile/contract.live.test.ts
git commit -m "test(model): opt-in live contract test for favourite models"
```

---

## Self-Review

**Spec coverage:**
- Layer 1 Catalog → Task 1 (supported params, completion limit, warm) + Task 12 step 5d (boot warm wiring); context sizing already consumes catalog at `context.ts:81`, fixed by the warm.
- Layer 2 Quirks → Task 5.
- Layer 3 Resolver → Task 6; Appliers → Tasks 3,4,7,8,9,10.
- Reasoning enablement + answer-token floor → Task 8; default effort → Task 11.
- Schema sanitization → Task 3; message normalization → Task 4.
- Provider routing → Task 9.
- Integration seams → Task 12.
- Testing strategy (unit + live contract) → all tasks + Task 13.
- Error handling (pure/total appliers, unknown-model defaults, catalog fallback) → Tasks 3,4,6,7 (defaults), Task 1 (catalog already falls back to disk in existing code).
- Anthropic byte-identical → Task 12 note + Task 6 (anthropic ids → adaptive) + Task 12 step 6 regression run.

**Placeholder scan:** No TBD/TODO; every code step contains full code; commands have expected output. Task 11 step 2 documents an intentionally-passing guard test (non-regression) — this is explicit, not a placeholder.

**Type consistency:** `ModelProfile` shape from Task 2 is used identically in Tasks 3–10/12. `ReasoningStrategy` kinds (`anthropic-adaptive|anthropic-budget|openrouter-effort|enable-flag|none`) are produced in Task 6 and consumed in Task 8. `applyModelProfileToBody(body, modelId, ctx)` signature defined in Task 12 is used identically in Task 13. Catalog fields added in Task 1 (`supportsReasoning`, `maxCompletionTokens`, `supportedParameters`) are read in Tasks 6/11.

**Scope:** Single subsystem, OpenRouter-only, no out-of-scope provider code. Layer 4 fallback chain intentionally deferred (noted in spec §3/§10), not in this plan.
