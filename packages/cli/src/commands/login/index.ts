import type { Command } from '../../commands.js'

// TODO: Anthropic account login. The local BYOK build authenticates via an
// API key, not an account, so /login is a hidden, disabled inert stub. The
// registry calls login() (a factory) to build the command, so the default
// export is a function.
const login = (): Command => ({
  type: 'local',
  name: 'login',
  description: 'login',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: 'text', value: '' }) }),
})

export default login
