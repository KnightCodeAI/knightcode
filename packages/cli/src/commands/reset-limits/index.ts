import type { Command } from '../../commands.js'

// TODO: Anthropic rate-limit reset (account/backend feature). Hidden, disabled
// inert stubs (interactive + non-interactive) so the registry still lists them.
export const resetLimits: Command = {
  type: 'local',
  name: 'reset-limits',
  description: 'reset-limits',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export const resetLimitsNonInteractive: Command = {
  type: 'local',
  name: 'reset-limits',
  description: 'reset-limits',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: true,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}
