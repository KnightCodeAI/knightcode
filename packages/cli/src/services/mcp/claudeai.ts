// TODO: the knightcode.raghavseth.in MCP connector (account-backed remote MCP servers fetched
// over the knightcode.raghavseth.in OAuth session) is not ported — this build is BYOK with no
// knightcode.raghavseth.in account. Inert: no connectors are ever eligible or fetched.

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
