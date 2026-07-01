import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { sleep } from '../../utils/sleep.js'
import { DESCRIPTION, SLEEP_TOOL_NAME, SLEEP_TOOL_PROMPT } from './prompt.js'

// Hard cap so a runaway value can't pin the agent indefinitely. The prompt
// notes the API prompt cache expires after ~5 minutes of inactivity, so
// sleeping much longer is rarely useful — but allow up to an hour.
const MAX_SLEEP_SECONDS = 3600

const inputSchema = lazySchema(() =>
  z.strictObject({
    seconds: z
      .number()
      .min(0)
      .max(MAX_SLEEP_SECONDS)
      .describe('How long to wait, in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    requestedSeconds: z.number(),
    sleptMs: z.number(),
    interrupted: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const SleepTool = buildTool({
  name: SLEEP_TOOL_NAME,
  searchHint: 'wait or pause for a duration',
  maxResultSizeChars: 10_000,
  userFacingName() {
    return 'Sleep'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SLEEP_TOOL_PROMPT
  },
  // Reading nothing, mutating nothing — purely waits.
  isReadOnly() {
    return true
  },
  // Safe to run alongside other tools (per the tool prompt).
  isConcurrencySafe() {
    return true
  },
  // A new user message should cancel the wait rather than queue behind it.
  interruptBehavior() {
    return 'cancel'
  },
  toAutoClassifierInput() {
    // Waiting has no security relevance.
    return ''
  },
  renderToolUseMessage(input) {
    if (input.seconds === undefined) return 'Sleeping…'
    return `Sleeping for ${input.seconds}s…`
  },
  async call({ seconds }, { abortController }) {
    const ms = Math.round(seconds * 1000)
    const start = Date.now()
    await sleep(ms, abortController?.signal)
    const sleptMs = Date.now() - start
    return {
      data: {
        requestedSeconds: seconds,
        sleptMs,
        interrupted: abortController?.signal.aborted ?? false,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const { requestedSeconds, interrupted } = content as Output
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: interrupted
        ? `Sleep interrupted before ${requestedSeconds}s elapsed`
        : `Slept for ${requestedSeconds}s`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
