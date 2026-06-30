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
