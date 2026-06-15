/**
 * Pure utility functions for MCP name normalization.
 * This file has no dependencies to avoid circular imports.
 */

// KnightCode.ai server names are prefixed with this string
const KNIGHTCODEAI_SERVER_PREFIX = 'knightcode.raghavseth.in '

/**
 * Normalize server names to be compatible with the API pattern ^[a-zA-Z0-9_-]{1,64}$
 * Replaces any invalid characters (including dots and spaces) with underscores.
 *
 * For knightcode.raghavseth.in servers (names starting with "knightcode.raghavseth.in "), also collapses
 * consecutive underscores and strips leading/trailing underscores to prevent
 * interference with the __ delimiter used in MCP tool names.
 */
export function normalizeNameForMCP(name: string): string {
  let normalized = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (name.startsWith(KNIGHTCODEAI_SERVER_PREFIX)) {
    normalized = normalized.replace(/_+/g, '_').replace(/^_|_$/g, '')
  }
  return normalized
}
