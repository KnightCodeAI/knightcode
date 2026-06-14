// TODO: MCP channel allowlisting lands with the MCP phase. The welcome notice
// reads the effective allowlist to flag unlisted channels; with no channels
// wired the allowlist is empty.

export type ChannelAllowlistEntry = {
  plugin: string
  marketplace: string
}

export type EffectiveChannelAllowlist = {
  entries: ChannelAllowlistEntry[]
  source: 'org' | 'ledger' | 'none'
}

export function getEffectiveChannelAllowlist(
  _subscriptionType: unknown,
  _allowedChannelPlugins?: unknown,
): EffectiveChannelAllowlist {
  return { entries: [], source: 'none' }
}
