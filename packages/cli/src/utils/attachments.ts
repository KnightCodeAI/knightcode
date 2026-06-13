// TODO: the full attachment pipeline (file/IDE/memory/todo attachment builders
// and the API normalization layer) lands later. This carries only the message
// constructor the tool/hook layer needs today.

import { randomUUID } from 'crypto'
import type { Tools, ToolUseContext } from '../Tool.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { AttachmentMessage, Message } from '../types/message.js'

/** The attachment payload carried by an AttachmentMessage. */
export type Attachment = AttachmentMessage['attachment']

export function createAttachmentMessage(
  attachment: AttachmentMessage['attachment'],
): AttachmentMessage {
  return {
    attachment,
    type: 'attachment',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

// The following attachment builders are part of the deferred attachment
// pipeline. Compaction re-injects file/agent/tool/MCP context after a summary;
// until the pipeline lands these report nothing to re-inject.

export async function generateFileAttachment(
  _filename: string,
  _toolUseContext: ToolUseContext & {
    fileReadingLimits?: { maxTokens?: number }
  },
  _successEventName: string,
  _errorEventName: string,
  _mode: 'compact' | 'at-mention',
  _options?: { offset?: number; limit?: number },
): Promise<Attachment | null> {
  return null
}

export function getDeferredToolsDeltaAttachment(
  _tools: Tools,
  _model: string,
  _messages: Message[] | undefined,
  _scanContext?: { callSite?: string },
): Attachment[] {
  return []
}

export function getAgentListingDeltaAttachment(
  _toolUseContext: ToolUseContext,
  _messages: Message[] | undefined,
): Attachment[] {
  return []
}

export function getMcpInstructionsDeltaAttachment(
  _mcpClients: MCPServerConnection[],
  _tools: Tools,
  _model: string,
  _messages: Message[] | undefined,
): Attachment[] {
  return []
}
