import type { Command } from '../../commands.js'

// TODO: internal tool-call debugging. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'debug-tool-call',
  description: 'debug-tool-call',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
