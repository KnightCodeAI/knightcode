// TODO: the full tool interface (call/validate/render surface, ToolUseContext)
// lands with the tool layer; this file carries the slice the API layer and
// message utilities consume so they port unchanged.

import type { z } from 'zod/v4'
import type { PermissionMode } from './types/permissions.js'
import type {
  AdditionalWorkingDirectory,
  ToolPermissionRulesBySource,
} from './types/permissions.js'

/** Data payload carried by a progress message. */
export type Progress = { type: string }

export type AnyObject = z.ZodType<{ [key: string]: unknown }>

export type QueryChainTracking = {
  chainId: string
  depth: number
}

/**
 * Context needed for permission checking in tools.
 */
export type ToolPermissionContext = {
  readonly mode: PermissionMode
  readonly additionalWorkingDirectories: ReadonlyMap<
    string,
    AdditionalWorkingDirectory
  >
  readonly alwaysAllowRules: ToolPermissionRulesBySource
  readonly alwaysDenyRules: ToolPermissionRulesBySource
  readonly alwaysAskRules: ToolPermissionRulesBySource
  readonly isBypassPermissionsModeAvailable: boolean
  readonly isAutoModeAvailable?: boolean
  readonly strippedDangerousRules?: ToolPermissionRulesBySource
  readonly shouldAvoidPermissionPrompts?: boolean
  readonly awaitAutomatedChecksBeforeDialog?: boolean
  readonly prePlanMode?: PermissionMode
}

export const getEmptyToolPermissionContext: () => ToolPermissionContext =
  () => ({
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  })

/**
 * The slice of the tool surface the API layer touches: identity, schema,
 * and the prompt() that becomes the API tool description.
 */
export type Tool = {
  name: string
  aliases?: string[]
  searchHint?: string
  prompt(options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: unknown[]
    allowedAgentTypes?: string[]
  }): Promise<string>
  readonly inputSchema: AnyObject
  readonly inputJSONSchema?: Record<string, unknown>
  strict?: boolean
  isLsp?: boolean
  isMcp?: boolean
  /** Never defer this tool behind ToolSearch. */
  alwaysLoad?: boolean
  readonly shouldDefer?: boolean
}

export type Tools = readonly Tool[]

/**
 * Checks if a tool matches the given name (primary name or alias).
 */
export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string,
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
}

/**
 * Finds a tool by name or alias from a list of tools.
 */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return tools.find(t => toolMatchesName(t, name))
}
