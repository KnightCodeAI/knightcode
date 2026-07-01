// Voice mode is not ported in this build. These functions exist so that
// ConfigTool's voice-setting branches (all guarded by the always-off
// `feature('VOICE_MODE')` flag) and its prompt import resolve. Every check
// returns false: voice settings are treated as unsupported.

/** Kill-switch / build-flag visibility check for voice mode. Always off here. */
export function isVoiceGrowthBookEnabled(): boolean {
  return false
}

/** Whether the user has the first-party OAuth auth voice mode requires. */
export function hasVoiceAuth(): boolean {
  return false
}

/** Runtime check combining the build flag, kill-switch, and auth. */
export function isVoiceModeEnabled(): boolean {
  return false
}
