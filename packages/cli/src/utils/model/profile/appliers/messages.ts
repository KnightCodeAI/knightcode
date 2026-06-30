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
        ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
        { type: 'thinking', thinking: '', signature: '' },
      ],
    }
  })

const scrub9 = (id: string) =>
  id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 9).padEnd(9, '0')

/** Mistral/Devstral require tool ids of exactly 9 alphanumeric chars, matched
 *  across the assistant tool_use and the corresponding tool_result. */
export const mistralScrubToolIds: MessageTransform = (msgs: any[]): any[] =>
  msgs.map(msg => {
    if (!Array.isArray(msg?.content)) return msg
    return {
      ...msg,
      content: msg.content.map((part: any) => {
        if (part?.type === 'tool_use' && typeof part.id === 'string') {
          return { ...part, id: scrub9(part.id) }
        }
        if (part?.type === 'tool_result' && typeof part.tool_use_id === 'string') {
          return { ...part, tool_use_id: scrub9(part.tool_use_id) }
        }
        return part
      }),
    }
  })

/** Run every message transform the profile carries. Total: returns input on error. */
export function normalizeMessagesForModel(msgs: any[], profile: ModelProfile): any[] {
  try {
    return profile.messageTransforms.reduce((acc, t) => t(acc), msgs)
  } catch {
    return msgs
  }
}
