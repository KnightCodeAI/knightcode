/**
 * `knightcode agents` — prints the list of configured agents and exits.
 *
 * Dynamically imported only when the subcommand runs. Mirrors the interactive
 * `/agents` command's grouping/override display via the shared helpers in
 * `agentDisplay.ts`, so the CLI listing and the in-REPL view stay consistent.
 */

import {
  AGENT_SOURCE_GROUPS,
  compareAgentsByName,
  getOverrideSourceLabel,
  type ResolvedAgent,
  resolveAgentModelDisplay,
  resolveAgentOverrides,
} from '../../tools/AgentTool/agentDisplay.js'
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getCwd } from '../../utils/cwd.js'

function formatAgent(agent: ResolvedAgent): string {
  const model = resolveAgentModelDisplay(agent)
  const parts = [agent.agentType]
  if (model) {
    parts.push(model)
  }
  if (agent.memory) {
    parts.push(`${agent.memory} memory`)
  }
  return parts.join(' · ')
}

export async function agentsHandler(): Promise<void> {
  const cwd = getCwd()
  const { allAgents } = await getAgentDefinitionsWithOverrides(cwd)
  const activeAgents = getActiveAgentsFromList(allAgents)
  const resolvedAgents = resolveAgentOverrides(allAgents, activeAgents)

  const lines: string[] = []
  let totalActive = 0

  for (const { label, source } of AGENT_SOURCE_GROUPS) {
    const groupAgents = resolvedAgents
      .filter(a => a.source === source)
      .sort(compareAgentsByName)

    if (groupAgents.length === 0) continue

    lines.push(`${label}:`)
    for (const agent of groupAgents) {
      if (agent.overriddenBy) {
        const winnerSource = getOverrideSourceLabel(agent.overriddenBy)
        lines.push(`  (shadowed by ${winnerSource}) ${formatAgent(agent)}`)
      } else {
        lines.push(`  ${formatAgent(agent)}`)
        totalActive++
      }
    }
    lines.push('')
  }

  if (lines.length === 0) {
    process.stdout.write('No agents found.\n')
  } else {
    process.stdout.write(`${totalActive} active agents\n\n`)
    process.stdout.write(`${lines.join('\n').trimEnd()}\n`)
  }
}
