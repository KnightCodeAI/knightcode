// TODO: full session/project storage (transcript dirs, history files) lands
// with the harness. The permission layer only needs the per-project directory
// used to classify project paths; it is rooted at the config dir so the
// classification is stable until the storage layer lands.

import { join } from 'path'
import memoize from 'lodash-es/memoize.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'

export function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

export const getProjectDir = memoize((projectDir: string): string => {
  return join(getProjectsDir(), sanitizePath(projectDir))
})
