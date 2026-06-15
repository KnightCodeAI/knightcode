// TODO: request helpers beyond the user agent land with their consumers.

/**
 * User-Agent for outgoing API requests.
 * SDK consumers can identify their app/library via env, mirroring the
 * upstream contract (KNIGHTCODE_AGENT_SDK_VERSION / KNIGHTCODE_AGENT_SDK_CLIENT_APP).
 */
export function getUserAgent(): string {
  const agentSdkVersion = process.env.KNIGHTCODE_AGENT_SDK_VERSION
    ? `, agent-sdk/${process.env.KNIGHTCODE_AGENT_SDK_VERSION}`
    : ''
  const clientApp = process.env.KNIGHTCODE_AGENT_SDK_CLIENT_APP
    ? `, client-app/${process.env.KNIGHTCODE_AGENT_SDK_CLIENT_APP}`
    : ''
  return `knightcode-cli/${MACRO.VERSION} (external, ${process.env.KNIGHTCODE_CODE_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp})`
}

/** User-Agent sent on MCP HTTP/WebSocket requests. */
export function getMCPUserAgent(): string {
  return getUserAgent()
}
