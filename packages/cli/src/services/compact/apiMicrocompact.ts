// TODO: API-side context management lands with the compaction layer.

export type ContextManagementConfig = Record<string, unknown>

export function getAPIContextManagement(_options?: {
  hasThinking?: boolean
  isRedactThinkingActive?: boolean
  clearAllThinking?: boolean
}): ContextManagementConfig | undefined {
  return undefined
}
