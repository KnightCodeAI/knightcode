// TODO: the full application state slice (settings, mode, queues, background
// task registry, …) lands with the harness. The tool context threads AppState
// through getAppState/setAppState; only the permission slice tools read today
// is typed — the rest stays open until the real store ports.

import type { MCPServerConnection } from '../services/mcp/types.js'
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { ToolPermissionContext } from '../Tool.js'
import type { DenialTrackingState } from '../utils/permissions/denialTracking.js'
import type { EffortValue } from '../utils/effort.js'
import type { TodoList } from '../utils/todo/types.js'
import type { Command } from '../types/command.js'

export type AppState = {
  toolPermissionContext: ToolPermissionContext
  /** Session/agent task checklists, keyed by agentId (or session id for the main thread). */
  todos: Record<string, TodoList>
  /** Background task registry, keyed by task id. Empty until the task runner
   *  lands, but compaction reads it to re-announce in-flight async agents. */
  tasks: Record<string, LocalAgentTaskState>
  /** Active reasoning-effort setting threaded into model requests. */
  effortValue?: EffortValue
  /** Consecutive/total denial counters for auto-mode classifier backoff. */
  denialTracking?: DenialTrackingState
  /**
   * Connected MCP servers. Stays empty until the MCP transport lands, but the
   * tool executor reads the connection list (and skill commands) for
   * attachments and auth-status updates.
   */
  mcp: {
    clients: MCPServerConnection[]
    commands: Command[]
  }
  /**
   * Swarm/teammate context. Undefined in solo mode (the only mode today); the
   * attachment pipeline reads team membership when it is present.
   */
  teamContext?: {
    teamName: string
    leadAgentId: string
    teammates: {
      [teammateId: string]: {
        name: string
        spawnedAt: number
        [key: string]: unknown
      }
    }
    [key: string]: unknown
  }
  /** Cross-agent message inbox. Empty in solo mode. */
  inbox: {
    messages: Array<{
      id: string
      from: string
      text: string
      timestamp: string
      status: 'pending' | 'processing' | 'processed'
      color?: string
      summary?: string
    }>
  }
  /** Pending plan verification state, set when exiting plan mode. */
  pendingPlanVerification?: {
    plan: string
    verificationStarted: boolean
    verificationCompleted: boolean
  }
  [key: string]: unknown
}
