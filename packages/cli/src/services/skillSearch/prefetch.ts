// TODO: experimental skill-search turn-zero discovery is not implemented yet.
// When enabled the attachment pipeline blocks on this to surface relevant
// skills on the first turn; until the subsystem lands it discovers nothing.
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Attachment } from '../../utils/attachments.js'

export async function getTurnZeroSkillDiscovery(
  _input: string | null,
  _messages: Message[],
  _context: ToolUseContext & { abortController: AbortController },
): Promise<Attachment[]> {
  return []
}

// Opaque handle for an in-flight prefetch; nothing is scheduled while the
// subsystem is unimplemented.
export type SkillDiscoveryPrefetchHandle = { readonly _tag: 'skill-prefetch' }

export function startSkillDiscoveryPrefetch(
  _input: string | null,
  _messages: Message[],
  _context: ToolUseContext,
): SkillDiscoveryPrefetchHandle | null {
  return null
}

export async function collectSkillDiscoveryPrefetch(
  _handle: SkillDiscoveryPrefetchHandle,
): Promise<Attachment[]> {
  return []
}
