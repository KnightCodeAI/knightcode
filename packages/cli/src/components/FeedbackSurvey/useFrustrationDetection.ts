// TODO: frustration detection — internal-only dogfooding signal. Not ported;
// always reports the closed (no-survey) state.

export function useFrustrationDetection(..._args: unknown[]): {
  state: 'closed'
  handleTranscriptSelect: () => void
} {
  return { state: 'closed', handleTranscriptSelect: () => {} }
}
