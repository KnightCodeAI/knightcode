// TODO: the ExitPlanMode tool lands with the plan-mode permission flow. Only the
// allowed-prompt type that AppState's initialMessage carries is modelled today.

export type AllowedPrompt = {
  prompt: string
  /** The tool name this prompt rule applies to. */
  tool: string
  [key: string]: unknown
}

// TODO: the ExitPlanMode tool body lands with the plan-mode flow. The permission
// UI dispatches on this tool's identity, so a stub singleton lives here; it
// reports disabled and never executes.
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    plan: z.string().describe('The plan to present for approval'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const ExitPlanModeV2Tool = buildTool({
  name: EXIT_PLAN_MODE_V2_TOOL_NAME,
  isEnabled: () => false,
  maxResultSizeChars: 0,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  async description() {
    return ''
  },
  async prompt() {
    return ''
  },
  renderToolUseMessage(_input, _options) {
    return null
  },
  mapToolResultToToolResultBlockParam(_content, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: '' }
  },
  async call(): Promise<never> {
    throw new Error('ExitPlanMode is not available in this build')
  },
})
