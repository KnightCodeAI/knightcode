// TODO: multi-agent / teammate spawning is an out-of-scope swarm subsystem. The
// Agent tool reaches this only when a `name` (teammate) is supplied, which the
// swarm-enabled gate keeps off in this build. Spawning is unsupported until the
// swarm runtime lands.
import type { ToolUseContext } from '../../Tool.js'

export type SpawnTeammateConfig = {
  name: string
  prompt: string
  description?: string
  [key: string]: unknown
}

export type SpawnOutput = {
  teammate_id: string
  agent_id: string
  agent_type?: string
  model?: string
  name: string
  color?: string
  tmux_session_name: string
  tmux_window_name: string
  tmux_pane_id: string
  team_name?: string
  is_splitpane?: boolean
  plan_mode_required?: boolean
}

export async function spawnTeammate(
  _config: SpawnTeammateConfig,
  _context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  throw new Error('Spawning teammates is not supported yet')
}
