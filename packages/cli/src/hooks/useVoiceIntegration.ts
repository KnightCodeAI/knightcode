// TODO: voice mode — speech input/keybinding handling. Gated off (VOICE_MODE);
// the hook reports no voice state and the keybinding handler renders nothing.

export function useVoiceIntegration(..._args: unknown[]): {
  stripTrailing: () => number
  handleKeyEvent: () => void
  resetAnchor: () => void
  interimRange: null
} {
  return {
    stripTrailing: () => 0,
    handleKeyEvent: () => {},
    resetAnchor: () => {},
    interimRange: null,
  }
}

export function VoiceKeybindingHandler(_props: Record<string, unknown>): null {
  return null
}
