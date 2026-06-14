import uniqBy from 'lodash-es/uniqBy.js'
import type { Tool, ToolPermissionContext, Tools } from './Tool.js'
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from './tools/GlobTool/GlobTool.js'
import { GrepTool } from './tools/GrepTool/GrepTool.js'
import { PowerShellTool } from './tools/PowerShellTool/PowerShellTool.js'
import { TodoWriteTool } from './tools/TodoWriteTool/TodoWriteTool.js'
import { getDenyRules } from './utils/permissions/permissions.js'
import { getPlatform } from './utils/platform.js'

// The in-scope tool set. Agent/Skill/Web/Task/MCP tools and the Bash shell tool
// land with their owning subsystems; this registry assembles the foundational
// tools that execute today. PowerShell is the shell tool on Windows (its
// primary platform); the POSIX shell tool is deferred.

/** Predefined tool presets selectable with --tools. */
export const TOOL_PRESETS = ['default'] as const
export type ToolPreset = (typeof TOOL_PRESETS)[number]

export function parseToolPreset(preset: string): ToolPreset | null {
  const presetString = preset.toLowerCase()
  if (!TOOL_PRESETS.includes(presetString as ToolPreset)) {
    return null
  }
  return presetString as ToolPreset
}

/**
 * The exhaustive list of built-in tools available in the current environment.
 * Source of truth for the foundational tool set.
 */
export function getAllBaseTools(): Tools {
  return [
    ...(getPlatform() === 'windows' ? [PowerShellTool] : []),
    GlobTool,
    GrepTool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    TodoWriteTool,
  ]
}

/**
 * Drop tools blanket-denied by the permission context — a deny rule naming the
 * tool with no rule content removes it before the model ever sees it.
 */
export function filterToolsByDenyRules<T extends { name: string }>(
  tools: readonly T[],
  permissionContext: ToolPermissionContext,
): T[] {
  const denyRules = getDenyRules(permissionContext)
  return tools.filter(
    tool =>
      !denyRules.some(
        rule =>
          rule.ruleValue.toolName === tool.name && !rule.ruleValue.ruleContent,
      ),
  )
}

/**
 * Built-in tools for a permission context: blanket-denied tools removed, then
 * tools whose isEnabled() is false filtered out.
 */
export function getTools(permissionContext: ToolPermissionContext): Tools {
  const allowed = filterToolsByDenyRules(getAllBaseTools(), permissionContext)
  const isEnabled = allowed.map(tool => tool.isEnabled())
  return allowed.filter((_, i) => isEnabled[i])
}

// The shared pure function REPL and runAgent both use to build the final tool
// pool: the enabled built-ins plus the deny-filtered MCP tools.
export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)

  // Filter out MCP tools that are in the deny list
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)

  // Sort each partition for prompt-cache stability, keeping built-ins as a
  // contiguous prefix. The server's cache policy places a global cache
  // breakpoint after the last prefix-matched built-in tool; a flat sort would
  // interleave MCP tools into built-ins and invalidate all downstream cache
  // keys whenever an MCP tool sorts between existing built-ins. uniqBy
  // preserves insertion order, so built-ins win on name conflict.
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}

/** Names of the enabled tools in the default preset. */
export function getToolsForDefaultPreset(): string[] {
  const tools = getAllBaseTools()
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map((tool: Tool) => tool.name)
}
