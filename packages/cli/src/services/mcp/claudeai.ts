// TODO: the claude.ai MCP connector (account-backed remote MCP servers fetched
// over the claude.ai OAuth session) is not ported — this build is BYOK with no
// claude.ai account. Inert: no connectors are ever eligible or fetched.

import type { ScopedMcpServerConfig } from './types.js'

export async function fetchClaudeAIMcpConfigsIfEligible(): Promise<
  Record<string, ScopedMcpServerConfig>
> {
  return {}
}

export function clearClaudeAIMcpConfigsCache(): void {}

export function markClaudeAiMcpConnected(_name: string): void {}

export function hasClaudeAiMcpEverConnected(_name: string): boolean {
  return false
}
