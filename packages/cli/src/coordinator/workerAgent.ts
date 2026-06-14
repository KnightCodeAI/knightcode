// TODO: coordinator/worker swarm agents are an out-of-scope subsystem. The
// built-in agent registry references this only behind the COORDINATOR_MODE
// feature flag (off by default), so it resolves to no coordinator agents.
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'

export function getCoordinatorAgents(): AgentDefinition[] {
  return []
}
