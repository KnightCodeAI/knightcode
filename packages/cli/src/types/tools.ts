/**
 * Tool progress payload types. These ride on ProgressMessage<P> while a tool
 * runs and are consumed by the per-tool render layer.
 *
 * TODO: each variant is fleshed out as its tool's progress UI ports; for now
 * they carry the discriminator the message/grouping layer reads plus an open
 * payload so producers and consumers type-check.
 */

export type ToolProgressData = {
  type: string
  [key: string]: unknown
}

export type AgentToolProgress = ToolProgressData & { type: 'agent_progress' }
export type BashProgress = ToolProgressData & { type: 'bash_progress' }
export type MCPProgress = ToolProgressData & { type: 'mcp_progress' }
export type PowerShellProgress = ToolProgressData & {
  type: 'powershell_progress'
}
export type REPLToolProgress = ToolProgressData & { type: 'repl_progress' }
export type SkillToolProgress = ToolProgressData & { type: 'skill_progress' }
export type TaskOutputProgress = ToolProgressData & {
  type: 'task_output_progress'
}
export type WebSearchProgress = ToolProgressData & {
  type: 'web_search_progress'
}
