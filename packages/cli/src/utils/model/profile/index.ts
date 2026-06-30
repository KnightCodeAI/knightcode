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
