// TODO: inbound webhook content sanitization — owned by the claude.ai
// remote-control feature. Local-only build receives no webhook content.
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

export function sanitizeInboundWebhookContent(
  content: string | Array<ContentBlockParam>,
): string | Array<ContentBlockParam> {
  return content
}
