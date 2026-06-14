// TODO: the Bash tool execution body is not built yet. PowerShell is the
// primary shell tool on this platform; this module carries only the input
// shape the tool-execution layer references for Bash-tool-specific handling.

/** Input accepted by the Bash tool. */
export type BashToolInput = {
  /** The command to execute. */
  command: string
  /** Optional timeout in milliseconds. */
  timeout?: number
  /** Clear, concise description of what this command does. */
  description?: string
  /** Run the command in the background. */
  run_in_background?: boolean
  /** Override sandbox mode and run without sandboxing. */
  dangerouslyDisableSandbox?: boolean
  /** Internal: pre-computed sed edit result from a preview. */
  _simulatedSedEdit?: {
    filePath: string
    newContent: string
  }
}

// TODO: the Bash tool execution body is not built (PowerShell is the primary
// shell tool on this platform). The permission UI dispatches on this tool's
// identity and validates against its input schema, so a stub singleton with the
// real input shape lives here; it reports disabled and never executes.
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('The command to execute'),
    timeout: z.number().optional().describe('Optional timeout in milliseconds'),
    description: z
      .string()
      .optional()
      .describe('Clear, concise description of what this command does'),
    run_in_background: z
      .boolean()
      .optional()
      .describe('Run the command in the background'),
    dangerouslyDisableSandbox: z
      .boolean()
      .optional()
      .describe('Override sandbox mode and run without sandboxing'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const BashTool = buildTool({
  name: 'Bash',
  isEnabled: () => false,
  isReadOnly: (_input) => false,
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
    throw new Error('Bash is not available in this build')
  },
})
