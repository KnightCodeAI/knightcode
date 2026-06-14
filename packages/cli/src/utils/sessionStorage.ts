// TODO: full session/project storage (transcript dirs, history files) lands
// with the harness. The permission layer only needs the per-project directory
// used to classify project paths; it is rooted at the config dir so the
// classification is stable until the storage layer lands.

import { join } from 'path'
import memoize from 'lodash-es/memoize.js'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'
import type { QueueOperationMessage } from '../types/messageQueueTypes.js'
import type { AgentId } from '../types/ids.js'
import type { LogOption } from '../types/logs.js'

export function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

export const getProjectDir = memoize((projectDir: string): string => {
  return join(getProjectsDir(), sanitizePath(projectDir))
})

export function getTranscriptPath(): string {
  const projectDir = getProjectDir(getOriginalCwd())
  return join(projectDir, `${getSessionId()}.jsonl`)
}

// TODO: session metadata re-appending and the in-memory message cache are part
// of the session storage layer, which is not implemented yet. Compaction calls
// these to keep --resume metadata in window and to drop the stale message
// cache; until the layer lands they are inert.
export function reAppendSessionMetadata(): void {}

// TODO: session transcript discovery lands with the storage layer. The welcome
// feed lists recent sessions; with no transcript dir there are none yet.
export async function loadMessageLogs(_limit?: number): Promise<LogOption[]> {
  return []
}

export function clearSessionMessagesCache(): void {}

// TODO: session↔PR linking is recorded by the session-metadata layer. Until it
// lands the link is not persisted.
export async function linkSessionToPR(
  _sessionId: string,
  _prNumber: number,
  _prUrl: string,
  _prRepository: string,
  _fullPath?: string,
): Promise<void> {}

// TODO: queue-operation journaling is part of the session storage layer. The
// message queue records enqueue/remove operations for --resume; until the
// transcript store lands this is inert.
export async function recordQueueOperation(
  _queueOp: QueueOperationMessage,
): Promise<void> {}

// TODO: content-replacement journaling (recording tool-result truncations for
// --resume reconstruction) is part of the session storage layer. Until the
// transcript store lands this is inert.
export async function recordContentReplacement(
  _replacements: readonly unknown[],
  _agentId?: AgentId,
): Promise<void> {}

// TODO: session titles / agent-name persistence land with session storage. No
// title is recorded yet, so reads return undefined and writes are no-ops.
export function getCurrentSessionTitle(
  _sessionId: import('../types/ids.js').SessionId,
): string | undefined {
  return undefined
}

export async function saveAgentName(
  _sessionId: import('crypto').UUID,
  _agentName: string,
  _fullPath?: string,
  _source: 'user' | 'auto' = 'user',
): Promise<void> {}

export async function saveCustomTitle(
  _sessionId: import('crypto').UUID,
  _customTitle: string,
  _fullPath?: string,
  _source: 'user' | 'auto' = 'user',
): Promise<void> {}

// TODO: resume/session-log helpers below are inert placeholders consumed by the
// session pickers; the real readers land with the resume flow.
export function getSessionIdFromLog(_log: any): any { return undefined }
export function getFirstMeaningfulUserMessageTextContent(_log: any): any { return undefined }
export function isCustomTitleEnabled(): boolean { return false }
export function isLiteLog(_log: any): boolean { return false }
export function loadFullLog(log: any): Promise<any> { return Promise.resolve(log) }
export function isTranscriptMessage(
  entry: import('../types/logs.js').Entry,
): entry is import('../types/logs.js').TranscriptMessage {
  return (
    (entry as { type?: string }).type === 'user' ||
    (entry as { type?: string }).type === 'assistant'
  )
}

export type TeamInfo = {
  teamName?: string
  agentName?: string
}

// A message participates in the persisted parent-uuid chain unless it is a
// transient progress entry.
export function isChainParticipant(
  m: Pick<import('../types/message.js').Message, 'type'>,
): boolean {
  return m.type !== 'progress'
}

// Transcript persistence is not implemented yet; these preserve the call
// signatures the logging hook depends on. cleanMessagesForLogging passes the
// messages through untouched, and recordTranscript records nothing (so it
// reports no recorded uuid).
export function cleanMessagesForLogging(
  messages: import('../types/message.js').Message[],
  _allMessages: readonly import('../types/message.js').Message[] = messages,
): import('../types/message.js').Message[] {
  return messages
}

export async function recordTranscript(
  _messages: import('../types/message.js').Message[],
  _teamInfo?: TeamInfo,
  _startingParentUuidHint?: import('crypto').UUID,
  _allMessages?: readonly import('../types/message.js').Message[],
): Promise<import('crypto').UUID | null> {
  return null
}

// TODO: transcript reading, session-metadata persistence, and the resume
// reconstruction helpers below are part of the deferred storage layer. They
// preserve the call signatures the REPL / resume flow depend on; readers return
// empty results and writers are inert until the storage layer lands.
export function getAgentTranscriptPath(agentId: AgentId): string {
  return join(getProjectDir(getOriginalCwd()), `${agentId}.jsonl`)
}
export async function getAgentTranscript(
  _agentId: AgentId,
): Promise<{
  messages: import('../types/message.js').Message[]
  contentReplacements: unknown[]
} | null> {
  return null
}
export async function getLastSessionLog(
  _sessionId: import('crypto').UUID,
): Promise<LogOption | null> {
  return null
}
export async function loadTranscriptFile(
  _filePath: string,
  _opts?: { keepAllLeaves?: boolean },
): Promise<any> {
  return {
    messages: new Map(),
    summaries: new Map(),
    customTitles: new Map(),
    tags: new Map(),
    agentNames: new Map(),
  }
}
export function buildConversationChain(..._args: any[]): any[] {
  return []
}
export function removeExtraFields(_transcript: any[]): any[] {
  return _transcript
}
export function checkResumeConsistency(_chain: any[]): void {}
export function isEphemeralToolProgress(_dataType: unknown): boolean {
  return false
}
export function isLoggableMessage(_m: unknown): boolean {
  return true
}
export function clearSessionMetadata(): void {}
export function adoptResumedSessionFile(): void {}
export async function resetSessionFilePointer(): Promise<void> {}
export async function removeTranscriptMessage(
  _targetUuid: import('crypto').UUID,
): Promise<void> {}
export async function recordAttributionSnapshot(
  _snapshot: unknown,
): Promise<void> {}
export async function recordSidechainTranscript(
  _messages: import('../types/message.js').Message[],
  _agentId?: string,
  _startingParentUuid?: import('crypto').UUID | null,
): Promise<void> {}
export function restoreSessionMetadata(_meta: Record<string, unknown>): void {}
export function saveMode(_mode: 'coordinator' | 'normal'): void {}
export function saveWorktreeState(_worktreeSession: unknown): void {}

// TODO: progressive session-log loading (the /resume picker) lands with the
// transcript store. With no transcripts on disk there are no sessions to list,
// so every loader yields an empty result set.
export type SessionLogResult = {
  logs: LogOption[]
  allStatLogs: LogOption[]
  nextIndex: number
}
export async function loadAllProjectsMessageLogsProgressive(
  _limit?: number,
  _initialEnrichCount?: number,
): Promise<SessionLogResult> {
  return { logs: [], allStatLogs: [], nextIndex: 0 }
}
export async function loadSameRepoMessageLogsProgressive(
  _worktreePaths: string[],
  _limit?: number,
  _initialEnrichCount?: number,
): Promise<SessionLogResult> {
  return { logs: [], allStatLogs: [], nextIndex: 0 }
}
export async function enrichLogs(
  _allLogs: LogOption[],
  _startIndex: number,
  _count: number,
): Promise<{ logs: LogOption[]; nextIndex: number }> {
  return { logs: [], nextIndex: 0 }
}

// TODO: on-disk session transcripts (path resolution, custom titles, tags,
// agent colors, cross-project/same-repo log loading) land with the full
// session-store port. Until then these report no stored sessions so /resume,
// /branch, /tag and /color render their dialogs without persisting.
export function getTranscriptPathForSession(_sessionId: string): string {
  return ''
}

export async function saveTag(
  _sessionId: import('crypto').UUID,
  _tag: string,
  _fullPath?: string,
): Promise<void> {}

export function getCurrentSessionTag(
  _sessionId: import('crypto').UUID,
): string | undefined {
  return undefined
}

export async function saveAgentColor(
  _sessionId: import('crypto').UUID,
  _agentColor: string,
  _fullPath?: string,
): Promise<void> {}

export async function searchSessionsByCustomTitle(
  _query: string,
  _options?: { limit?: number; exact?: boolean },
): Promise<LogOption[]> {
  return []
}

export async function loadAllProjectsMessageLogs(
  _limit?: number,
  _options?: { skipIndex?: boolean; initialEnrichCount?: number },
): Promise<LogOption[]> {
  return []
}

export async function loadSameRepoMessageLogs(
  _worktreePaths: string[],
  _limit?: number,
  _initialEnrichCount?: number,
): Promise<LogOption[]> {
  return []
}
