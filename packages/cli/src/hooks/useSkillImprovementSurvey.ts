// TODO: skill-improvement survey — feedback prompt after skill use. Not ported.

export function useSkillImprovementSurvey(..._args: unknown[]): {
  suggestion: any
  isOpen: boolean
  handleSelect: (..._args: unknown[]) => void
} {
  return { suggestion: null, isOpen: false, handleSelect: () => {} }
}
