// TODO: session activity heartbeats are not implemented yet. They keep remote
// session transports alive during long operations; with no transport wired up
// tracking is inactive and the signal is a no-op.

export type SessionActivityReason = string

export function startSessionActivity(_reason: SessionActivityReason): void {}

export function stopSessionActivity(_reason: SessionActivityReason): void {}

export function isSessionActivityTrackingActive(): boolean {
  return false
}

export function sendSessionActivitySignal(): void {}
