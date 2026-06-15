// TODO: session-ingress auth (a JWT passed via file descriptor when the CLI
// runs behind a managed sandbox ingress proxy) is not ported — a local BYOK
// build connects to MCP servers directly. Inert: no ingress token is ever
// present, so MCP requests carry no ingress Authorization header.

export function getSessionIngressAuthToken(): string | null {
  return null
}

export function getSessionIngressAuthHeaders(): Record<string, string> {
  return {}
}

export function updateSessionIngressAuthToken(_token: string): void {}
