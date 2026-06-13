// TODO: session transcript segment writing is not implemented yet. Compaction
// fires this fire-and-forget inside a dead-code-eliminated feature guard to
// archive pre-compaction messages; until it lands this is inert.

import type { Message } from '../../types/message.js'

export async function writeSessionTranscriptSegment(
  _messages: Message[],
): Promise<void> {}

// Fire-and-forget date-change flush; inert until transcript writing lands.
export function flushOnDateChange(
  _messages: Message[],
  _currentDate: string,
): void {}
