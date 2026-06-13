// TODO: snip-based history compaction lands with the compaction layer.

import type { Message } from '../../types/message.js'

export function isSnipRuntimeEnabled(): boolean {
  return false
}

// Snip runtime is disabled, so the context-efficiency nudge never fires.
export function shouldNudgeForSnips(_messages: Message[]): boolean {
  return false
}

// History-snip compaction runs behind a feature gate that is off in this build,
// so the query loop never reaches this; it frees nothing.
export function snipCompactIfNeeded(messages: Message[]): {
  messages: Message[]
  tokensFreed: number
  boundaryMessage?: Message
} {
  return { messages, tokensFreed: 0 }
}
