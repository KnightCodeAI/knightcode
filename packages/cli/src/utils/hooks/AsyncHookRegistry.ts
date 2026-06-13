// TODO: the async hook registry (tracking long-running background hook
// processes and collecting their responses for delivery on a later turn) is
// not implemented yet. The attachment pipeline drains completed async hook
// responses into the turn and removes delivered ones; until the hook execution
// layer lands there are never any pending async hooks.
import type { HookEvent, SyncHookJSONOutput } from '../../entrypoints/agentSdkTypes.js'

export type AsyncHookResponse = {
  processId: string
  response: SyncHookJSONOutput
  hookName: string
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion'
  toolName?: string
  pluginId?: string
  stdout: string
  stderr: string
  exitCode?: number
}

export async function checkForAsyncHookResponses(): Promise<AsyncHookResponse[]> {
  return []
}

export function removeDeliveredAsyncHooks(_processIds: string[]): void {}
