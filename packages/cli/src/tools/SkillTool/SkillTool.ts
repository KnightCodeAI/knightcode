// TODO: the Skill tool (invoke a named skill) lands with the skills phase. The
// permission UI dispatches on its identity and validates against its input
// schema, so the real schema + name live here; the tool reports disabled and
// never executes until skills land.
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { SKILL_TOOL_NAME } from './constants.js'

export const inputSchema = lazySchema(() =>
  z.object({
    skill: z
      .string()
      .describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
    args: z.string().optional().describe('Optional arguments for the skill'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

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
  renderToolUseMessage(_input, _options) {
    return null
  },
  mapToolResultToToolResultBlockParam(_content, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: '' }
  },
  async call(): Promise<never> {
    throw new Error('Skill is not available in this build')
  },
})
