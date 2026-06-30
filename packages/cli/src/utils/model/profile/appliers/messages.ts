import type { MessageTransform, ModelProfile } from '../types.js'

/** DeepSeek requires every assistant message to carry a reasoning/thinking block. */
export const deepseekEnsureReasoning: MessageTransform = (msgs: any[]): any[] =>
  msgs.map(msg => {
    if (msg?.role !== 'assistant') return msg
    if (Array.isArray(msg.content)) {
      if (msg.content.some((p: any) => p.type === 'thinking' || p.type === 'reasoning')) return msg
      return { ...msg, content: [...msg.content, { type: 'thinking', thinking: '', signature: '' }] }
    }
    return {
      ...msg,
      content: [
        ...(typeof msg.content === 'string' && msg.content ? [{ type: 'text', text: msg.content }] : []),
        { type: 'thinking', thinking: '', signature: '' },
      ],
    }
  })

/** Fallback: truncate/scrub an id to 9 alphanumeric chars (for orphan tool_results). */
const truncate9 = (id: string) =>
  id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 9).padEnd(9, '0')

/** Mistral/Devstral require tool ids of exactly 9 alphanumeric chars, matched
 *  across the assistant tool_use and the corresponding tool_result.
 *  Uses a bijective per-call map so distinct ids always produce distinct tokens. */
export const mistralScrubToolIds: MessageTransform = (msgs: any[]): any[] => {
  // Pass 1: collect all tool_use ids in first-seen order (unique)
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const msg of msgs) {
    if (!Array.isArray(msg?.content)) continue
    for (const part of msg.content) {
      if (part?.type === 'tool_use' && typeof part.id === 'string' && !seen.has(part.id)) {
        ordered.push(part.id)
        seen.add(part.id)
      }
    }
  }

  // Build bijective map: original id → unique stable 9-char token
  const idMap = new Map<string, string>()
  ordered.forEach((id, index) => {
    idMap.set(id, 't' + String(index).padStart(8, '0'))
  })

  // Pass 2: rewrite tool_use.id and tool_result.tool_use_id via the map
  return msgs.map(msg => {
    if (!Array.isArray(msg?.content)) return msg
    return {
      ...msg,
      content: msg.content.map((part: any) => {
        if (part?.type === 'tool_use' && typeof part.id === 'string') {
          return { ...part, id: idMap.get(part.id) ?? truncate9(part.id) }
        }
        if (part?.type === 'tool_result' && typeof part.tool_use_id === 'string') {
          return { ...part, tool_use_id: idMap.get(part.tool_use_id) ?? truncate9(part.tool_use_id) }
        }
        return part
      }),
    }
  })
}

/** Run every message transform the profile carries. Total: returns input on error. */
export function normalizeMessagesForModel(msgs: any[], profile: ModelProfile): any[] {
  try {
    return profile.messageTransforms.reduce((acc, t) => t(acc), msgs)
  } catch {
    return msgs
  }
}
