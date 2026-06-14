/**
 * Undercover mode — safety utilities for contributing to public/open-source
 * repos. All code paths are gated on USER_TYPE === 'ant'; in this build that
 * branch is dead, so every function reduces to its trivial return: undercover
 * is never active and adds no instructions.
 */

export function isUndercover(): boolean {
  return false
}

export function getUndercoverInstructions(): string {
  return ''
}

export function shouldShowUndercoverAutoNotice(): boolean {
  return false
}
