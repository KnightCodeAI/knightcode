// TODO: useFeedbackSurvey — feedback survey trigger; surveys are not ported. Reports the
// closed state so the survey UI never opens.

export function useFeedbackSurvey(..._args: unknown[]): {
  state: string
  lastResponse: any
  handleSelect: (..._args: unknown[]) => boolean
  handleTranscriptSelect: (..._args: unknown[]) => boolean
} {
  return {
    state: 'closed',
    lastResponse: null,
    handleSelect: () => false,
    handleTranscriptSelect: () => false,
  }
}
