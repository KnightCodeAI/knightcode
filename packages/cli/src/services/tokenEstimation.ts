// TODO: API-backed token counting (Anthropic / Bedrock / Vertex count-tokens)
// is not implemented yet. The rough chars-per-token estimators below are pure
// and are what the compaction and context layers rely on until accurate API
// counts are available.

import type { Anthropic } from '@anthropic-ai/sdk'
import type { Attachment } from '../utils/attachments.js'
import { normalizeAttachmentForAPI } from '../utils/messages.js'
import { jsonStringify } from '../utils/slowOperations.js'

export async function countTokensWithAPI(
  content: string,
): Promise<number | null> {
  return roughTokenCountEstimation(content)
}

export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = 4,
): number {
  return Math.round(content.length / bytesPerToken)
}

/**
 * Returns an estimated bytes-per-token ratio for a given file extension.
 * Dense JSON has many single-character tokens (`{`, `}`, `:`, `,`, `"`)
 * which makes the real ratio closer to 2 rather than the default 4.
 */
export function bytesPerTokenForFileType(fileExtension: string): number {
  switch (fileExtension) {
    case 'json':
    case 'jsonl':
    case 'jsonc':
      return 2
    default:
      return 4
  }
}

/**
 * Like {@link roughTokenCountEstimation} but uses a more accurate
 * bytes-per-token ratio when the file type is known.
 *
 * This matters when the API-based token count is unavailable (e.g. on
 * Bedrock) and we fall back to the rough estimate — an underestimate can
 * let an oversized tool result slip into the conversation.
 */
export function roughTokenCountEstimationForFileType(
  content: string,
  fileExtension: string,
): number {
  return roughTokenCountEstimation(
    content,
    bytesPerTokenForFileType(fileExtension),
  )
}

export function roughTokenCountEstimationForMessages(
  messages: readonly {
    type: string
    message?: { content?: unknown }
    attachment?: Attachment
  }[],
): number {
  let totalTokens = 0
  for (const message of messages) {
    totalTokens += roughTokenCountEstimationForMessage(message)
  }
  return totalTokens
}

export function roughTokenCountEstimationForMessage(message: {
  type: string
  message?: { content?: unknown }
  attachment?: Attachment
}): number {
  if (
    (message.type === 'assistant' || message.type === 'user') &&
    message.message?.content
  ) {
    return roughTokenCountEstimationForContent(
      message.message?.content as
        | string
        | Array<Anthropic.ContentBlock>
        | Array<Anthropic.ContentBlockParam>
        | undefined,
    )
  }

  if (message.type === 'attachment' && message.attachment) {
    const userMessages = normalizeAttachmentForAPI(message.attachment)
    let total = 0
    for (const userMsg of userMessages) {
      total += roughTokenCountEstimationForContent(
        userMsg.message.content as unknown as
          | string
          | Array<Anthropic.ContentBlockParam>
          | undefined,
      )
    }
    return total
  }

  return 0
}

function roughTokenCountEstimationForContent(
  content:
    | string
    | Array<Anthropic.ContentBlock>
    | Array<Anthropic.ContentBlockParam>
    | undefined,
): number {
  if (!content) {
    return 0
  }
  if (typeof content === 'string') {
    return roughTokenCountEstimation(content)
  }
  let totalTokens = 0
  for (const block of content) {
    totalTokens += roughTokenCountEstimationForBlock(block)
  }
  return totalTokens
}

function roughTokenCountEstimationForBlock(
  block: string | Anthropic.ContentBlock | Anthropic.ContentBlockParam,
): number {
  if (typeof block === 'string') {
    return roughTokenCountEstimation(block)
  }
  if (block.type === 'text') {
    return roughTokenCountEstimation(block.text)
  }
  if (block.type === 'image' || block.type === 'document') {
    // Images are resized to a bounded size; use a conservative estimate that
    // matches microCompact's IMAGE_MAX_TOKEN_SIZE to avoid underestimating and
    // triggering auto-compact too late. document base64 must NOT reach the
    // jsonStringify catch-all — a 1MB PDF is ~1.33M base64 chars → ~325k
    // estimated tokens, vs the ~2000 the API actually charges.
    return 2000
  }
  if (block.type === 'tool_result') {
    return roughTokenCountEstimationForContent(
      block.content as unknown as
        | string
        | Array<Anthropic.ContentBlockParam>
        | undefined,
    )
  }
  if (block.type === 'tool_use') {
    // input is the JSON the model generated — arbitrarily large (bash
    // commands, Edit diffs, file contents). Stringify once for the char count;
    // the API re-serializes anyway so this is what it sees.
    return roughTokenCountEstimation(
      block.name + jsonStringify(block.input ?? {}),
    )
  }
  if (block.type === 'thinking') {
    return roughTokenCountEstimation(block.thinking)
  }
  if (block.type === 'redacted_thinking') {
    return roughTokenCountEstimation(block.data)
  }
  // server_tool_use, web_search_tool_result, mcp_tool_use, etc. — text-like
  // payloads (tool inputs, search results, no base64). Stringify-length tracks
  // the serialized form the API sees.
  return roughTokenCountEstimation(jsonStringify(block))
}
