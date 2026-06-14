import type { Command } from '../../commands.js'

// TODO: Anthropic privacy settings. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'privacy-settings',
  description: 'privacy-settings',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
