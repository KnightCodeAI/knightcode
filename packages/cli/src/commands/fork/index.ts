import type { Command } from '../../commands.js'

// TODO: fork command lands behind a feature gate that is off in this build.
// Hidden, disabled inert stub so the gated typeof-import resolves.
const command: Command = {
  type: 'local',
  name: 'fork',
  description: 'fork',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
