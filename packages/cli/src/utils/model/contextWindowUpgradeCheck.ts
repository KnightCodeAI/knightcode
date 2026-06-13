// TODO: model context-window upgrade prompts are Anthropic-account UX and are
// out of scope. No upgrade is ever offered.
export function getUpgradeMessage(_context: 'warning' | 'tip'): string | null {
  return null
}
