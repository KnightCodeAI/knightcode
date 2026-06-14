// TODO: proxy/mTLS/CA-bundle support lands later; until then requests use
// the runtime's default fetch behavior.

export function getProxyFetchOptions(_opts?: {
  forAnthropicAPI?: boolean
}): Record<string, never> {
  return {}
}

export function disableKeepAlive(): void {}

// TODO: managed proxy config is out of scope for a BYOK build.
export function getProxyUrl(): string | undefined { return undefined }
