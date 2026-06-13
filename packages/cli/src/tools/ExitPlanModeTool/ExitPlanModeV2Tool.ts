// TODO: the ExitPlanMode tool lands with the plan-mode permission flow. Only the
// allowed-prompt type that AppState's initialMessage carries is modelled today.

export type AllowedPrompt = {
  prompt: string
  [key: string]: unknown
}
