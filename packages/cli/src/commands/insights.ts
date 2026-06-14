import type { Command } from '../commands.js'

// TODO: session-insights analysis (a large report generator over local session
// transcripts) is out of scope for this build. Hidden, disabled inert stub.
const insights: Command = {
  type: 'prompt',
  name: 'insights',
  description: 'insights',
  contentLength: 0,
  progressMessage: 'analyzing your sessions',
  source: 'builtin',
  isEnabled: () => false,
  isHidden: true,
  async getPromptForCommand() {
    return []
  },
}

export default insights
