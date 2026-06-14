// TODO: the AskUserQuestion tool (model asks the user a multiple-choice
// question mid-turn) is not shipped in this build. The permission UI renders
// the question dialog and validates against this input schema, so the real
// schemas + Question/QuestionOption types + name live here; the tool reports
// disabled and never executes until the feature lands.
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  ASK_USER_QUESTION_TOOL_CHIP_WIDTH,
  ASK_USER_QUESTION_TOOL_NAME,
} from './prompt.js'

const questionOptionSchema = lazySchema(() =>
  z.object({
    label: z
      .string()
      .describe(
        'The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.',
      ),
    description: z
      .string()
      .describe(
        'Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.',
      ),
    preview: z
      .string()
      .optional()
      .describe(
        'Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options.',
      ),
  }),
)

const questionSchema = lazySchema(() =>
  z.object({
    question: z
      .string()
      .describe(
        'The complete question to ask the user. Should be clear, specific, and end with a question mark.',
      ),
    header: z
      .string()
      .describe(
        `Very short label displayed as a chip/tag (max ${ASK_USER_QUESTION_TOOL_CHIP_WIDTH} chars). Examples: "Auth method", "Library", "Approach".`,
      ),
    options: z
      .array(questionOptionSchema())
      .min(2)
      .max(4)
      .describe(
        "The available choices for this question. Must have 2-4 options. There should be no 'Other' option, that will be provided automatically.",
      ),
    multiSelect: z
      .boolean()
      .default(false)
      .describe(
        'Set to true to allow the user to select multiple options instead of just one.',
      ),
  }),
)

const annotationsSchema = lazySchema(() =>
  z
    .record(
      z.string(),
      z.object({
        preview: z
          .string()
          .optional()
          .describe(
            'The preview content of the selected option, if the question used previews.',
          ),
        notes: z
          .string()
          .optional()
          .describe('Free-text notes the user added to their selection.'),
      }),
    )
    .optional()
    .describe(
      'Optional per-question annotations from the user. Keyed by question text.',
    ),
)

const inputSchema = lazySchema(() =>
  z.strictObject({
    questions: z
      .array(questionSchema())
      .min(1)
      .max(4)
      .describe('Questions to ask the user (1-4 questions)'),
    answers: z
      .record(z.string(), z.string())
      .optional()
      .describe('User answers collected by the permission component'),
    annotations: annotationsSchema(),
    metadata: z
      .object({
        source: z
          .string()
          .optional()
          .describe('Optional identifier for the source of this question.'),
      })
      .optional()
      .describe('Optional metadata for tracking purposes. Not displayed.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export type Question = z.infer<ReturnType<typeof questionSchema>>
export type QuestionOption = z.infer<ReturnType<typeof questionOptionSchema>>

export const AskUserQuestionTool = buildTool({
  name: ASK_USER_QUESTION_TOOL_NAME,
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
    throw new Error('AskUserQuestion is not available in this build')
  },
})
