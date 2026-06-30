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
