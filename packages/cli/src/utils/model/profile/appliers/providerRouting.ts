import type { ModelProfile } from '../types.js'

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Pin OpenRouter routing. Default policy: require_parameters:true so OR only
 * routes to backends that support the params we send (e.g. reasoning). A quirk
 * may supply a richer `provider` object via extraBody, which takes precedence.
 * Merges with any existing body.provider so user-supplied values are preserved.
 */
export function applyProviderRouting(
  body: Record<string, any>,
  profile: ModelProfile,
): Record<string, any> {
  const existing = isObj(body.provider) ? body.provider : {}
  const override = isObj(profile.extraBody.provider) ? profile.extraBody.provider : undefined
  body.provider = { ...existing, require_parameters: true, ...(override ?? {}) }
  return body
}
