// TODO: the analytics metadata builders that depend on input serialization and
// command parsing land with the telemetry decision; the pure name/extension
// extractors callers need today live here.

import { isEnvTruthy } from '../../utils/envUtils.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './index.js'

export type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS }

/**
 * MCP tool names can embed server/tool identifiers; collapse them to a
 * generic label so analytics payloads never carry user-defined names.
 */
export function sanitizeToolNameForAnalytics(
  toolName: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  if (toolName.startsWith('mcp__')) {
    return 'mcp_tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }
  return toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * A file's extension is safe to record in analytics (it carries no path or
 * user content); the rest of the path is not. Returns undefined when the file
 * has no extension.
 */
export function getFileExtensionForAnalytics(
  filePath: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filePath)
  if (!match || !match[1]) return undefined
  return match[1].toLowerCase() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export function isToolDetailsLoggingEnabled(): boolean {
  return isEnvTruthy(process.env.OTEL_LOG_TOOL_DETAILS)
}

/**
 * Extract MCP server and tool names from a full MCP tool name.
 * MCP tool names follow the format: mcp__<server>__<tool>
 */
export function extractMcpToolDetails(toolName: string):
  | {
      serverName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      mcpToolName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    }
  | undefined {
  if (!toolName.startsWith('mcp__')) {
    return undefined
  }

  // Format: mcp__<server>__<tool>
  const parts = toolName.split('__')
  if (parts.length < 3) {
    return undefined
  }

  const serverName = parts[1]
  // Tool name may contain __ so rejoin remaining parts
  const mcpToolName = parts.slice(2).join('__')

  if (!serverName || !mcpToolName) {
    return undefined
  }

  return {
    serverName:
      serverName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    mcpToolName:
      mcpToolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  }
}

/**
 * Extract skill name from Skill tool input.
 */
export function extractSkillName(
  toolName: string,
  input: unknown,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  if (toolName !== 'Skill') {
    return undefined
  }

  if (
    typeof input === 'object' &&
    input !== null &&
    'skill' in input &&
    typeof (input as { skill: unknown }).skill === 'string'
  ) {
    return (input as { skill: string })
      .skill as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }

  return undefined
}

// TODO: full per-server gating for MCP analytics details lands with the
// telemetry decision; until then no server/tool detail is attached.
export function mcpToolDetailsForAnalytics(
  _toolName: string,
  _mcpServerType: string | undefined,
  _mcpServerBaseUrl: string | undefined,
): {
  mcpServerName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  mcpToolName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  return {}
}

// TODO: tool-input serialization for telemetry lands with the telemetry
// decision; until then no serialized input is attached.
export function extractToolInputForTelemetry(_input: unknown): string | undefined {
  return undefined
}

// TODO: file-extension extraction from shell commands lands with the telemetry
// decision; until then no extension is attached.
export function getFileExtensionsFromBashCommand(
  _command: string,
  _simulatedSedEditFilePath?: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  return undefined
}
