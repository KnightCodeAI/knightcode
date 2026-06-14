// TODO: assistant mode (perpetual claude.ai session across CLI restarts) —
// owned by the claude.ai remote-control feature. Local-only build is always
// a fresh per-invocation session.
export function isAssistantMode(): boolean {
  return false
}
