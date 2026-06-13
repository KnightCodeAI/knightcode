// TODO: the plan-file storage feature isn't ported. The permission layer only
// needs the directory and slug used to classify plan paths; both are rooted at
// the config dir so the classification is stable until the feature lands.

import { join } from 'path'
import memoize from 'lodash-es/memoize.js'
import { getSessionId } from '../bootstrap/state.js'
import { getClaudeConfigHomeDir } from './envUtils.js'

export const getPlansDirectory = memoize(function getPlansDirectory(): string {
  return join(getClaudeConfigHomeDir(), 'plans')
})

export function getPlanSlug(sessionId: string = getSessionId()): string {
  return `plan-${sessionId}`
}
