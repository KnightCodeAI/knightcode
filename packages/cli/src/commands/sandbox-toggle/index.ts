import type { Command } from '../../commands.js'

// TODO: sandbox/computer-use. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'sandbox-toggle',
  description: 'sandbox-toggle',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
