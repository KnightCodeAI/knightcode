// TODO: workflow-script commands land with the workflow subsystem. The feature
// gate is off in this build, so no workflow commands are discovered.
import type { Command } from '../../commands.js'

export async function getWorkflowCommands(_cwd: string): Promise<Command[]> {
  return []
}
