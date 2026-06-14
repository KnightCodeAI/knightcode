import type { Command } from '../../commands.js'

// TODO: Anthropic rate-limit options. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'rate-limit-options',
  description: 'rate-limit-options',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
