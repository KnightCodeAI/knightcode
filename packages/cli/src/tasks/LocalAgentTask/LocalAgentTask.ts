// TODO: the background local-agent task runner (progress tracking, eviction,
// disk bootstrap) is not implemented yet. This carries the task-state shape the
// compaction and attachment layers read; the runtime that produces and mutates
// these records lands with the task subsystem.

export type LocalAgentTaskStatus = 'pending' | 'running' | 'completed' | 'error'

export type LocalAgentTaskState = {
  type: 'local_agent'
  agentId: string
  status: LocalAgentTaskStatus
  description: string
  retrieved: boolean
  error?: string
  progress?: { summary?: string }
}
