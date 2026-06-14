// TODO: inbound remote-control message parsing — owned by the claude.ai
// remote-control feature. Local-only build receives no inbound messages.
import type { UUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'

export function extractInboundMessageFields(
  _msg: SDKMessage,
):
  | { content: string | Array<ContentBlockParam>; uuid: UUID | undefined }
  | undefined {
  return undefined
}
