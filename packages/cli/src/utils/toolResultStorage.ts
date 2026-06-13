// TODO: only the persisted-record type and the results-directory path live
// here so the log types compile and the permission layer can classify paths;
// the storage/budgeting implementation lands with the tool execution layer.

import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getSessionId } from '../bootstrap/state.js'

export const TOOL_RESULTS_SUBDIR = 'tool-results'

function getSessionDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions', getSessionId())
}

export function getToolResultsDir(): string {
  return join(getSessionDir(), TOOL_RESULTS_SUBDIR)
}

/**
 * Records a tool-result content replacement (large output swapped for a
 * placeholder) so session resume can reconstruct the original transcript.
 */
export type ContentReplacementRecord = {
  kind: 'tool-result'
  toolUseId: string
  replacement: string
}

/**
 * Per-conversation-thread state for the tool-result budget: which tool-use ids
 * have been seen and what their content was replaced with.
 */
export type ContentReplacementState = {
  seenIds: Set<string>
  replacements: Map<string, string>
}

export function createContentReplacementState(): ContentReplacementState {
  return { seenIds: new Set(), replacements: new Map() }
}
