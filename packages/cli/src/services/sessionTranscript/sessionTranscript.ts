// TODO: session transcript segment writing is not implemented yet. Compaction
// fires this fire-and-forget inside a dead-code-eliminated feature guard to
// archive pre-compaction messages; until it lands this is inert.

import type { Message } from '../../types/message.js'

export async function writeSessionTranscriptSegment(
  _messages: Message[],
): Promise<void> {}
