// TODO: slack channel suggestions belong to the slack MCP integration and are
// not wired here.
import type { SuggestionItem } from '../../components/PromptInput/PromptInputFooterSuggestions.js'

export const subscribeKnownChannels = (_onChange: () => void): (() => void) => {
  return () => {}
}

export function getKnownChannelsVersion(): number {
  return 0
}

export function hasSlackMcpServer(_clients: unknown[]): boolean {
  return false
}

export function findSlackChannelPositions(
  _text: string,
): Array<{ start: number; end: number }> {
  return []
}

export async function getSlackChannelSuggestions(
  _clients: unknown[],
  _searchToken: string,
): Promise<SuggestionItem[]> {
  return []
}
