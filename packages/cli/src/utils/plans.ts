// TODO: the plan-file storage feature isn't ported. The permission layer only
// needs the directory and slug used to classify plan paths; both are rooted at
// the config dir so the classification is stable until the feature lands.

import { join } from 'path'
import memoize from 'lodash-es/memoize.js'
import { getSessionId } from '../bootstrap/state.js'
import type { AgentId } from '../types/ids.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'

export const getPlansDirectory = memoize(function getPlansDirectory(): string {
  return join(getClaudeConfigHomeDir(), 'plans')
})

export function getPlanSlug(sessionId: string = getSessionId()): string {
  return `plan-${sessionId}`
}

export function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())

  // Main conversation: simple filename with word slug
  if (!agentId) {
    return join(getPlansDirectory(), `${planSlug}.md`)
  }

  // Subagents: include agent ID
  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
}

export function getPlan(agentId?: AgentId): string | null {
  const filePath = getPlanFilePath(agentId)
  try {
    return getFsImplementation().readFileSync(filePath, { encoding: 'utf-8' })
  } catch (error) {
    if (isENOENT(error)) return null
    logError(error)
    return null
  }
}
