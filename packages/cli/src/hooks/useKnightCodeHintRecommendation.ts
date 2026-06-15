// TODO: useKnightCodeHintRecommendation — surfaces an inline recommendation menu for a subsystem that isn't
// ported. With nothing to recommend, the hook stays empty.

export function useKnightCodeHintRecommendation(..._args: unknown[]): {
  recommendation: any
  handleResponse: (..._args: unknown[]) => void
} {
  return { recommendation: null, handleResponse: () => {} }
}
