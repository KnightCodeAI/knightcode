import type { Command } from '../../commands.js'

// TODO: IDE integration. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'ide',
  description: 'ide',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
