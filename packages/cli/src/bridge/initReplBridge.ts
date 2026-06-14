// TODO: remote-control bridge initialization — owned by the claude.ai
// remote-control feature. Local-only build never starts a bridge session.
import type { BridgeState, ReplBridgeHandle } from './replBridge.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js'
import type { Message } from '../types/message.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'

export type InitBridgeOptions = {
  onInboundMessage?: (msg: SDKMessage) => void | Promise<void>
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  initialMessages?: Message[]
  initialName?: string
  getMessages?: () => Message[]
  previouslyFlushedUUIDs?: Set<string>
  perpetual?: boolean
  outboundOnly?: boolean
  tags?: string[]
}

export async function initReplBridge(
  _options?: InitBridgeOptions,
): Promise<ReplBridgeHandle | null> {
  return null
}
