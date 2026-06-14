// Plugin identifier parsing ("name" or "name@marketplace") and official-
// marketplace classification. The broader plugin install/scope machinery lands
// with the plugin subsystem; these are the pure helpers the Skill tool uses for
// telemetry redaction.

// Anthropic-controlled marketplaces. Identifiers from these are safe to log to
// general-access fields; third-party ones are treated as PII-tagged.
export const ALLOWED_OFFICIAL_MARKETPLACE_NAMES = new Set([
  'claude-code-marketplace',
  'claude-code-plugins',
  'claude-plugins-official',
  'anthropic-marketplace',
])

export type ParsedPluginIdentifier = {
  name: string
  marketplace?: string
}

// Only the first '@' is the separator; marketplace names contain no '@'.
export function parsePluginIdentifier(plugin: string): ParsedPluginIdentifier {
  if (plugin.includes('@')) {
    const parts = plugin.split('@')
    return { name: parts[0] || '', marketplace: parts[1] }
  }
  return { name: plugin }
}

export function buildPluginId(name: string, marketplace?: string): string {
  return marketplace ? `${name}@${marketplace}` : name
}

export function isOfficialMarketplaceName(
  marketplace: string | undefined,
): boolean {
  return (
    marketplace !== undefined &&
    ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(marketplace.toLowerCase())
  )
}
