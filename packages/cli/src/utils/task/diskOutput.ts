// TODO: task background-output storage lands with the task tools. The Read
// tool only needs the directory used to classify task-output paths; it is
// rooted at the config dir so the classification is stable until then.

import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'

export function getTaskOutputDir(): string {
  return join(getClaudeConfigHomeDir(), 'task-output')
}
