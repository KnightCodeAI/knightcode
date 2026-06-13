// TODO: MCP monitor tasks land with the MCP subsystem. Only the state shape (as
// a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  isBackgrounded?: boolean
}
