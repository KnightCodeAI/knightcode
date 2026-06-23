import uniqBy from 'lodash-es/uniqBy.js'
import type { Tool, ToolPermissionContext, Tools } from './Tool.js'
import { AgentTool } from './tools/AgentTool/AgentTool.js'
import { AskUserQuestionTool } from './tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { BashTool } from './tools/BashTool/BashTool.js'
import { EnterPlanModeTool } from './tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { ExitPlanModeV2Tool } from './tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from './tools/GlobTool/GlobTool.js'
import { GrepTool } from './tools/GrepTool/GrepTool.js'
import { NotebookEditTool } from './tools/NotebookEditTool/NotebookEditTool.js'
import { PowerShellTool } from './tools/PowerShellTool/PowerShellTool.js'
import { SkillTool } from './tools/SkillTool/SkillTool.js'
import { TodoWriteTool } from './tools/TodoWriteTool/TodoWriteTool.js'
import { ListMcpResourcesTool } from './tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from './tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { ToolSearchTool } from './tools/ToolSearchTool/ToolSearchTool.js'
import { WebFetchTool } from './tools/WebFetchTool/WebFetchTool.js'
import { getDenyRules } from './utils/permissions/permissions.js'
import { isEnvTruthy } from './utils/envUtils.js'
import { getPlatform } from './utils/platform.js'
import { isToolSearchEnabledOptimistic } from './utils/toolSearch.js'

// The set of tools a sub-agent may never call. Defined in constants/tools.ts;
// re-exported here because the sub-agent pool filter and agent hooks import it
// from the tool registry.
export { ALL_AGENT_DISALLOWED_TOOLS } from './constants/tools.js'

// The in-scope tool set. The Agent (sub-agent spawning), Bash, and NotebookEdit
// tools are registered here; Skill/Web/MCP tools land with their owning
// subsystems. PowerShell is also offered on Windows (its primary platform).

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
    AgentTool,
    BashTool,
    ...(getPlatform() === 'windows' ? [PowerShellTool] : []),
    GlobTool,
    GrepTool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookEditTool,
    TodoWriteTool,
    SkillTool,
    WebFetchTool,
    AskUserQuestionTool,
    EnterPlanModeTool,
    ExitPlanModeV2Tool,
    ListMcpResourcesTool,
    ReadMcpResourceTool,
    // Include ToolSearchTool when tool search might be enabled (optimistic check).
    // The actual decision to defer tools happens at request time.
    ...(isToolSearchEnabledOptimistic() ? [ToolSearchTool] : []),
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
 *
 * Simple mode (--bare / KNIGHTCODE_CODE_SIMPLE) restricts the surface to
 * Bash, Read, and Edit. (Upstream's REPL-mode and coordinator sub-branches are
 * omitted: KnightCode ships no REPLTool in the base set and coordinator mode is
 * disabled, so neither path is reachable here.)
 */
export function getTools(permissionContext: ToolPermissionContext): Tools {
  if (isEnvTruthy(process.env.KNIGHTCODE_CODE_SIMPLE)) {
    const simpleTools: Tool[] = [BashTool, FileReadTool, FileEditTool]
    return filterToolsByDenyRules(simpleTools, permissionContext)
  }
  const allowed = filterToolsByDenyRules(getAllBaseTools(), permissionContext)
  const isEnabled = allowed.map(tool => tool.isEnabled())
  return allowed.filter((_, i) => isEnabled[i])
}

/**
 * All tools — built-ins plus MCP tools — without cache-stable sorting or
 * dedup. Preferred when the complete list matters (token counting, tool-search
 * thresholds). Use getTools() when only built-ins are needed; use
 * assembleToolPool() for the cache-stable, deduplicated model-facing pool.
 */
export function getMergedTools(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  return [...getTools(permissionContext), ...mcpTools]
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
  // The resource tools are added conditionally (they back the MCP resource
  // commands, not the default model toolset) — exclude them from the preset.
  const specialTools = new Set([
    ListMcpResourcesTool.name,
    ReadMcpResourceTool.name,
  ])
  const tools = getAllBaseTools().filter(tool => !specialTools.has(tool.name))
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map((tool: Tool) => tool.name)
}
