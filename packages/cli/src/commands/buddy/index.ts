import type { Command } from '../../commands.js'

// TODO: buddy command lands behind a feature gate that is off in this build.
// Hidden, disabled inert stub so the gated typeof-import resolves.
const command: Command = {
  type: 'local',
  name: 'buddy',
  description: 'buddy',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
