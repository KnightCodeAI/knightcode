// TODO: remote `claude assistant` session-history loader — owned by the
// claude.ai remote-control feature. The local-only build never runs a viewer
// session (the consuming hook is gated on config.viewerOnly), so history
// fetching is inert: auth context is empty and pages resolve to null.
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'

export const HISTORY_PAGE_SIZE = 100

export type HistoryPage = {
  events: SDKMessage[]
  firstId: string | null
  hasMore: boolean
}

export type HistoryAuthCtx = {
  baseUrl: string
  headers: Record<string, string>
}

export async function createHistoryAuthCtx(
  _sessionId: string,
): Promise<HistoryAuthCtx> {
  return { baseUrl: '', headers: {} }
}

export async function fetchLatestEvents(
  _ctx: HistoryAuthCtx,
  _limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  return null
}

export async function fetchOlderEvents(
  _ctx: HistoryAuthCtx,
  _beforeId: string,
  _limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage | null> {
  return null
}
