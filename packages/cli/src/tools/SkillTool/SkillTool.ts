// TODO: the Skill tool (invoke a named skill) lands with the skills phase. The
// permission UI dispatches on its identity and validates against its input
// schema, so the real schema + name live here; the tool reports disabled and
// never executes until skills land.
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { SkillToolProgress } from '../../types/tools.js'
import { SKILL_TOOL_NAME } from './constants.js'
import {
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

export const inputSchema = lazySchema(() =>
  z.object({
    skill: z
      .string()
      .describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
    args: z.string().optional().describe('Optional arguments for the skill'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() => {
  // Output schema for inline skills (default)
  const inlineOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill is valid'),
    commandName: z.string().describe('The name of the skill'),
    allowedTools: z
      .array(z.string())
      .optional()
      .describe('Tools allowed by this skill'),
    model: z.string().optional().describe('Model override if specified'),
    status: z.literal('inline').optional().describe('Execution status'),
  })

  // Output schema for forked skills
  const forkedOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill completed successfully'),
    commandName: z.string().describe('The name of the skill'),
    status: z.literal('forked').describe('Execution status'),
    agentId: z
      .string()
      .describe('The ID of the sub-agent that executed the skill'),
    result: z.string().describe('The result from the forked skill execution'),
  })

  return z.union([inlineOutputSchema, forkedOutputSchema])
})
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.input<OutputSchema>
export type Progress = SkillToolProgress

export const SkillTool = buildTool({
  name: SKILL_TOOL_NAME,
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
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  mapToolResultToToolResultBlockParam(_content, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: '' }
  },
  async call(): Promise<never> {
    throw new Error('Skill is not available in this build')
  },
})
