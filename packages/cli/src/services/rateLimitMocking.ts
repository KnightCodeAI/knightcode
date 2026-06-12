// TODO: the /mock-limits developer command is not ported; mocking is inert.

import type { APIError } from '@anthropic-ai/sdk'

export function shouldProcessRateLimits(isSubscriber: boolean): boolean {
  return isSubscriber
}

export function checkMockRateLimitError(
  _currentModel: string,
  _isFastModeActive?: boolean,
): APIError | null {
  return null
}

export function isMockRateLimitError(_error: APIError): boolean {
  return false
}
