// Session-scoped flag tracking whether the auto-mode classifier is active.
// Set true when the user transitions into 'auto' (see transitionPermissionMode)
// and consulted by the plan+auto branch in permissions.ts and the PromptInput
// decline path. Module-level on purpose: it mirrors the current permission mode
// for the single interactive process and is reset on transition out of auto.

let active = false

export function isAutoModeActive(): boolean {
  return active
}

export function setAutoModeActive(value: boolean): void {
  active = value
}
