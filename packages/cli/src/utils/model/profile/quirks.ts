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
