import type { Command } from '../../commands.js'

// TODO: plugin-backed rewind (later phase). Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'thinkback',
  description: 'thinkback',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
