import type { Command } from '../../commands.js'

// TODO: Anthropic account auth. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'oauth-refresh',
  description: 'oauth-refresh',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
