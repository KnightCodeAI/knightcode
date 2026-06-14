import type { Command } from '../../commands.js'

// TODO: internal heap diagnostics. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'heapdump',
  description: 'heapdump',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
