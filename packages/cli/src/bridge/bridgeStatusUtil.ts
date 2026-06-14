// TODO: the remote-control bridge status belongs to the remote/ssh session
// subsystem and is not wired here.
import { getClaudeAiBaseUrl } from '../constants/product.js'

export type BridgeStatusInfo = {
  label:
    | 'Remote Control failed'
    | 'Remote Control reconnecting'
    | 'Remote Control active'
    | 'Remote Control connecting…'
  color: 'error' | 'warning' | 'success'
}

export function getBridgeStatus(_state: {
  error: string | undefined
  connected: boolean
  sessionActive: boolean
  reconnecting: boolean
}): BridgeStatusInfo {
  return { label: 'Remote Control connecting…', color: 'warning' }
}

export function buildBridgeConnectUrl(
  environmentId: string,
  ingressUrl?: string,
): string {
  const baseUrl = getClaudeAiBaseUrl(undefined, ingressUrl)
  return `${baseUrl}/code?bridge=${environmentId}`
}
