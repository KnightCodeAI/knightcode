// TODO: snip-based history compaction lands with the compaction layer.

import type { Message } from '../../types/message.js'

export function isSnipRuntimeEnabled(): boolean {
  return false
}

// Snip runtime is disabled, so the context-efficiency nudge never fires.
export function shouldNudgeForSnips(_messages: Message[]): boolean {
  return false
}
