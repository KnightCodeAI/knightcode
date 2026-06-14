// TODO: web fetch (retrieve a URL and run a prompt over its content) is not
// shipped in this build. The permission UI dispatches on this tool's identity
// and validates against its input schema, so the real schema + name live here;
// the tool reports disabled and never executes until the feature lands.
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { WEB_FETCH_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z.string().describe('The prompt to run on the fetched content'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const WebFetchTool = buildTool({
  name: WEB_FETCH_TOOL_NAME,
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
    throw new Error('WebFetch is not available in this build')
  },
})
