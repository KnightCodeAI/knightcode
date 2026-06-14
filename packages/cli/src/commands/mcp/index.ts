import type { Command } from '../../commands.js'

// TODO: MCP management UI (later phase). Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: 'local',
  name: 'mcp',
  description: 'mcp',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
}

export default command
