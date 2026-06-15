// TODO: mTLS / managed-enterprise transport config — out of scope, inert stub.
import type { ConnectionOptions } from 'tls'

export function getMTLSConfig(..._args: any[]): any {
  return null;
}

// No client-cert/mTLS configured: WebSocket MCP connects with default TLS.
export function getWebSocketTLSOptions(): ConnectionOptions | undefined {
  return undefined
}
