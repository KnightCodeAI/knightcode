// TODO: internal (ant-only) diagnostic logging is not implemented yet. These
// surfaces record permission-context snapshots for internal analysis; they are
// inert for external builds and stay inert until the logging backend lands.

import type { ToolPermissionContext } from '../Tool.js'

export async function logPermissionContextForAnts(
  _toolPermissionContext: ToolPermissionContext | null,
  _moment: 'summary' | 'initialization',
): Promise<void> {}
