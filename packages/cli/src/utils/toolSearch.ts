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

// TODO: tool-search availability detection lands with the tool-search layer.
// Until deferred tools are wired up the search tool is never present.
export function isToolSearchToolAvailable(
  _tools: readonly { name: string }[],
): boolean {
  return false
}

export function isDeferredToolsDeltaEnabled(): boolean {
  return false
}

export type DeferredToolsDelta = {
  addedNames: string[]
  /** Rendered lines for addedNames; the scan reconstructs from names. */
  addedLines: string[]
  removedNames: string[]
}

/** Call-site discriminator for deferred-tool delta scans. */
export type DeferredToolsDeltaScanContext = {
  callSite:
    | 'attachments_main'
    | 'attachments_subagent'
    | 'compact_full'
    | 'compact_partial'
    | 'reactive_compact'
  querySource?: string
}

// TODO: deferred-tool delta diffing lands with the tool-search layer. The
// announce gate (isDeferredToolsDeltaEnabled) is off, so the attachment caller
// never reaches this; it reports no delta.
export function getDeferredToolsDelta(
  _tools: Tools,
  _messages: Message[],
  _scanContext?: DeferredToolsDeltaScanContext,
): DeferredToolsDelta | null {
  return null
}

// TODO: tool_reference is a beta not wired in this build; no model advertises
// support until the tool-search layer lands.
export function modelSupportsToolReference(_model: string): boolean {
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
