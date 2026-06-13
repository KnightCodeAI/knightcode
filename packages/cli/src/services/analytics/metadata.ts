// TODO: the full analytics metadata builders land with the telemetry
// decision; only the tool-name sanitizer the message layer needs lives here.

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
