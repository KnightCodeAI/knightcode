// TODO: request helpers beyond the user agent land with their consumers.

/**
 * User-Agent for outgoing API requests.
 * SDK consumers can identify their app/library via env, mirroring the
 * upstream contract (CLAUDE_AGENT_SDK_VERSION / CLAUDE_AGENT_SDK_CLIENT_APP).
 */
export function getUserAgent(): string {
  const agentSdkVersion = process.env.CLAUDE_AGENT_SDK_VERSION
    ? `, agent-sdk/${process.env.CLAUDE_AGENT_SDK_VERSION}`
    : ''
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
    ? `, client-app/${process.env.CLAUDE_AGENT_SDK_CLIENT_APP}`
    : ''
  return `claude-cli/${MACRO.VERSION} (external, ${process.env.CLAUDE_CODE_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp})`
}

/** User-Agent sent on MCP HTTP/WebSocket requests. */
export function getMCPUserAgent(): string {
  return getUserAgent()
}
