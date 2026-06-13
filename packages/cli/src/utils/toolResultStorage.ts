// TODO: only the persisted-record type and the results-directory path live
// here so the log types compile and the permission layer can classify paths;
// the storage/budgeting implementation lands with the tool execution layer.

import { mkdir } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getSessionId } from '../bootstrap/state.js'
import { formatFileSize } from './format.js'

export const TOOL_RESULTS_SUBDIR = 'tool-results'

// XML tags wrapping a persisted-output reference message.
export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'

// Preview size in bytes for the reference message.
export const PREVIEW_SIZE_BYTES = 2000

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

/** Result of persisting a large tool result to disk. */
export type PersistedToolResult = {
  filepath: string
  originalSize: number
  isJson: boolean
  preview: string
  hasMore: boolean
}

/** Filepath where a tool result would be persisted. */
export function getToolResultPath(id: string, isJson: boolean): string {
  const ext = isJson ? 'json' : 'txt'
  return join(getToolResultsDir(), `${id}.${ext}`)
}

/** Ensure the session-specific tool-results directory exists. */
export async function ensureToolResultsDir(): Promise<void> {
  try {
    await mkdir(getToolResultsDir(), { recursive: true })
  } catch {
    // Directory may already exist
  }
}

/** Build the reference message shown in place of an over-large tool result. */
export function buildLargeToolResultMessage(
  result: PersistedToolResult,
): string {
  let message = `${PERSISTED_OUTPUT_TAG}\n`
  message += `Output too large (${formatFileSize(result.originalSize)}). Full output saved to: ${result.filepath}\n\n`
  message += `Preview (first ${formatFileSize(PREVIEW_SIZE_BYTES)}):\n`
  message += result.preview
  message += result.hasMore ? '\n...\n' : '\n'
  message += PERSISTED_OUTPUT_CLOSING_TAG
  return message
}

/** Preview of content, truncating at a newline boundary when possible. */
export function generatePreview(
  content: string,
  maxBytes: number,
): { preview: string; hasMore: boolean } {
  if (content.length <= maxBytes) {
    return { preview: content, hasMore: false }
  }
  const truncated = content.slice(0, maxBytes)
  const lastNewline = truncated.lastIndexOf('\n')
  const cutPoint = lastNewline > maxBytes * 0.5 ? lastNewline : maxBytes
  return { preview: content.slice(0, cutPoint), hasMore: true }
}
