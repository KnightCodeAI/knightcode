// Builds the "always allow reads from this directory" permission-rule
// suggestion the filesystem checks attach to an ask result. The persistence
// of accepted suggestions (writing them to settings files) lives in the
// settings layer that lands with the harness.

import { posix } from 'path'
import type { PermissionUpdateDestination } from '../../types/permissions.js'
import { toPosixPath } from './filesystem.js'
import type { PermissionUpdate } from './PermissionUpdateSchema.js'

export function createReadRuleSuggestion(
  dirPath: string,
  destination: PermissionUpdateDestination = 'session',
): PermissionUpdate | undefined {
  // Convert to POSIX format for pattern matching (handles Windows internally)
  const pathForPattern = toPosixPath(dirPath)

  // Root directory is too broad to be a reasonable permission target
  if (pathForPattern === '/') {
    return undefined
  }

  // For absolute paths, prepend an extra / to create //path/** pattern
  const ruleContent = posix.isAbsolute(pathForPattern)
    ? `/${pathForPattern}/**`
    : `${pathForPattern}/**`

  return {
    type: 'addRules',
    rules: [
      {
        toolName: 'Read',
        ruleContent,
      },
    ],
    behavior: 'allow',
    destination,
  }
}
