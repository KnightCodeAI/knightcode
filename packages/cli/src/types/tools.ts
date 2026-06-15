/**
 * Tool progress payload types. These ride on ProgressMessage<P> while a tool
 * runs and are consumed by the per-tool render layer.
 *
 * TODO: each variant is fleshed out as its tool's progress UI ports; for now
 * they carry the discriminator the message/grouping layer reads plus an open
 * payload so producers and consumers type-check.
 */

import type { AssistantMessage, NormalizedUserMessage } from './message.js'

// Discriminated by `type` so consumers narrowing on the tag get the variant's
// fields; each member stays open ([key: string]: unknown) for producer payloads
// whose full shape ports with the owning tool's progress UI.
export type ToolProgressData =
  | {
      type: 'bash_progress'
      output: string
      fullOutput: string
      elapsedTimeSeconds: number
      totalLines: number
      totalBytes?: number
      timeoutMs?: number
      taskId?: string
      [key: string]: unknown
    }
  | {
      type: 'powershell_progress'
      elapsedTimeSeconds: number
      totalLines: number
      [key: string]: unknown
    }
  | {
      type: 'repl_tool_call'
      phase: string
      toolInput: unknown
      toolName: string
      [key: string]: unknown
    }
  | { type: 'hook_progress'; hookEvent: string; [key: string]: unknown }
  | { type: 'agent_progress'; [key: string]: unknown }
  | { type: 'mcp_progress'; [key: string]: unknown }
  | { type: 'repl_progress'; [key: string]: unknown }
  | {
      type: 'skill_progress'
      message: AssistantMessage | NormalizedUserMessage
      prompt: string
      agentId: string
      [key: string]: unknown
    }
  | { type: 'task_output_progress'; [key: string]: unknown }
  | { type: 'web_search_progress'; [key: string]: unknown }

// Carries a sub-agent's streamed message up to the parent's progress renderer.
export type AgentToolProgress = {
  type: 'agent_progress'
  message: AssistantMessage | NormalizedUserMessage
  prompt?: string
  agentId?: string
  [key: string]: unknown
}
export type BashProgress = ToolProgressData & { type: 'bash_progress' }
// Shell progress (bash or powershell) forwarded from a sub-agent to the parent.
export type ShellProgress = Extract<
  ToolProgressData,
  { type: 'bash_progress' | 'powershell_progress' }
>
export type MCPProgress = ToolProgressData & {
  type: 'mcp_progress'
  // MCP progress-notification payload (SDK ProgressNotification params).
  progress?: number
  total?: number
  progressMessage?: string
}
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
