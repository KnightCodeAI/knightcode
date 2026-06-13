// TODO: the interactive permission hook (queue-backed prompt UI, decision
// logging) lands with the harness. Only the function type the tool/permission
// layer depends on lives here.

import type { Tool, ToolUseContext } from '../Tool.js'
import type { AssistantMessage } from '../types/message.js'
import type { PermissionResult } from '../types/permissions.js'

/**
 * Resolves whether a tool may run with the given input in the current context,
 * prompting the user when the permission system can't decide on its own.
 */
export type CanUseToolFn<
  Input extends Record<string, unknown> = Record<string, unknown>,
> = (
  tool: Tool,
  input: Input,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: PermissionResult<Input>,
) => Promise<PermissionResult<Input>>
