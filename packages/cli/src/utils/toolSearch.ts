// TODO: the deferred-tool search layer (tool_reference expansion, context
// scoring, beta gating) lands with the tool layer; only the block predicate
// the message utilities need lives here for now.

import type { Message } from '../types/message.js'
import type { Tool, ToolPermissionContext, Tools } from '../Tool.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'

export async function isToolSearchEnabled(
  _model: string,
  _tools: Tools,
  _getToolPermissionContext: () => Promise<ToolPermissionContext>,
  _agents: AgentDefinition[],
  _source?: string,
): Promise<boolean> {
  return false
}

export function isToolSearchEnabledOptimistic(): boolean {
  return false
}

export function isDeferredToolsDeltaEnabled(): boolean {
  return false
}

/** Tool names announced via ToolSearch results in prior turns. */
export function extractDiscoveredToolNames(_messages: Message[]): Set<string> {
  return new Set()
}

/**
 * Check if an object is a tool_reference block.
 * tool_reference is a beta feature not in the SDK types, so we need runtime checks.
 */
export function isToolReferenceBlock(obj: unknown): boolean {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    (obj as { type: unknown }).type === 'tool_reference'
  )
}
