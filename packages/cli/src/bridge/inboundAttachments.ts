// TODO: inbound remote-control attachment resolution — owned by the claude.ai
// remote-control feature. Local-only build has no inbound attachments to resolve.
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

export async function resolveAndPrepend(
  _msg: unknown,
  content: string | Array<ContentBlockParam>,
): Promise<string | Array<ContentBlockParam>> {
  return content
}
