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

// With no managed/sandbox proxy, every host bypasses the proxy (direct request).
export function shouldBypassProxy(_host: string): boolean {
  return true
}

// No proxy configured: WebSocket MCP connects directly.
export function getWebSocketProxyAgent(
  _url: string,
): import('http').Agent | undefined {
  return undefined
}

export function getWebSocketProxyUrl(_url: string): string | undefined {
  return undefined
}
