import { describe, expect, it } from 'bun:test'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/index.mjs'
import {
  createAssistantMessage,
  getAssistantMessageText,
  getLastAssistantMessage,
} from '../../utils/messages.js'
import { mergeStreamedAssistantTurn } from './compact.js'

// The streaming layer yields one AssistantMessage per content block. For
// OpenRouter reasoning models the block order is text → thinking →
// redacted_thinking, so a `redacted_thinking` block stops LAST.
const textBlock: BetaContentBlock = {
  type: 'text',
  text: 'Summary: the user asked to read src/buddy; we explained it.',
  citations: [],
} as unknown as BetaContentBlock
const thinkingBlock: BetaContentBlock = {
  type: 'thinking',
  thinking: 'We need to produce analysis then summary...',
  signature: 'sig',
} as unknown as BetaContentBlock
const redactedThinkingBlock: BetaContentBlock = {
  type: 'redacted_thinking',
  data: 'openrouter.reasoning:abc123',
} as unknown as BetaContentBlock

describe('mergeStreamedAssistantTurn', () => {
  it('preserves the text block even when redacted_thinking is yielded last', () => {
    // Mimics the stream: one message per block, in stop order.
    const streamed = [
      createAssistantMessage({ content: [textBlock] }),
      createAssistantMessage({ content: [thinkingBlock] }),
      createAssistantMessage({ content: [redactedThinkingBlock] }),
    ]

    // Control: the old "keep the last message" behavior loses the text.
    expect(getAssistantMessageText(getLastAssistantMessage(streamed)!)).toBeNull()

    // Fixed: merging the turn recovers the summary text.
    const merged = mergeStreamedAssistantTurn(streamed)
    expect(merged).toBeDefined()
    expect(getAssistantMessageText(merged!)).toBe(
      'Summary: the user asked to read src/buddy; we explained it.',
    )
  })

  it('returns undefined when there are no assistant messages', () => {
    expect(mergeStreamedAssistantTurn([])).toBeUndefined()
  })

  it('returns an API-error message as-is so error handling still fires', () => {
    const errorMsg = createAssistantMessage({
      content: [textBlock],
    })
    ;(errorMsg as { isApiErrorMessage?: boolean }).isApiErrorMessage = true
    const merged = mergeStreamedAssistantTurn([
      createAssistantMessage({ content: [thinkingBlock] }),
      errorMsg,
    ])
    expect(merged).toBe(errorMsg)
  })
})
