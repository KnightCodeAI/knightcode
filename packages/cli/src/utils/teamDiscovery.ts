// TODO: team discovery belongs to the teammate/swarm orchestration subsystem;
// only the summary type is consumed by the prompt-input surface.
export type TeamSummary = {
  name: string
  memberCount: number
  runningCount: number
  idleCount: number
}
