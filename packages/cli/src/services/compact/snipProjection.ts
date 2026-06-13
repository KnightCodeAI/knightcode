// TODO: history-snip projection is not implemented yet. It is gated behind a
// feature flag and consulted only inside a dead-code-eliminated guard when
// slicing messages after a compact boundary; until it lands the identity
// projection keeps every message.

import type { Message } from '../../types/message.js'

export function projectSnippedView(messages: Message[]): Message[] {
  return messages
}
