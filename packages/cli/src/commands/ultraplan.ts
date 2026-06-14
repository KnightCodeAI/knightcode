// TODO: Ultraplan (web-backed plan refinement) is gated behind a feature flag
// this build never enables. The plan-mode exit dialog only calls this under
// that flag, so the launcher is inert and resolves to an empty result.
import type { AppState } from '../state/AppState.js'

export async function launchUltraplan(_opts: {
  blurb: string
  seedPlan: string
  getAppState: () => AppState
  setAppState: (updater: (prev: AppState) => AppState) => void
  signal: AbortSignal
}): Promise<string> {
  return ''
}

// TODO: ultraplan task control lands with the ultraplan command; inert stop.
export async function stopUltraplan(_taskId: string, _sessionId: string, _setAppState: (f: (p: any) => any) => void): Promise<void> {}
