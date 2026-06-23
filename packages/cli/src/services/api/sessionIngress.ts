// TODO: session ingress — server-side session intake for hosted modes. Not
// ported; under BYOK there is no ingress backend, so the remote-persistence
// path in sessionStorage stays dead (gated behind ENABLE_SESSION_PERSISTENCE +
// a remoteIngressUrl that is never set). These stubs preserve the call
// signatures that path references.

import type { Entry } from '../../types/logs.js'

export function clearAllSessions(): void {}

/** Append a single transcript entry to the remote session log. Returns false
 * (no backend) — the caller only reaches this when remote persistence is
 * explicitly enabled, which never happens in a BYOK build. */
export async function appendSessionLog(
  _sessionId: string,
  _entry: Entry,
  _ingressUrl: string,
): Promise<boolean> {
  return false
}

/** Fetch the full remote session log for hydration. Returns null (no backend). */
export async function getSessionLogs(
  _sessionId: string,
  _ingressUrl: string,
): Promise<Entry[] | null> {
  return null
}
