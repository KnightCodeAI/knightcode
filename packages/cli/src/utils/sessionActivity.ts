// TODO: session activity heartbeats land with the harness phase.

export type SessionActivityReason = string

export function startSessionActivity(_reason: SessionActivityReason): void {}

export function stopSessionActivity(_reason: SessionActivityReason): void {}
