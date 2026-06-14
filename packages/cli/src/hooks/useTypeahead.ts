// TODO: typeahead/autocomplete (slash-command, file, agent and channel
// suggestions) is driven by the commands/suggestions subsystem and is not wired
// here. The hook returns an empty, inert suggestion state so the input renders
// without live completions.
import type { SuggestionItem } from '../components/PromptInput/PromptInputFooterSuggestions.js'
import type { InlineGhostText } from '../types/textInputTypes.js'

type UseTypeaheadResult = {
  suggestions: SuggestionItem[]
  selectedSuggestion: number
  commandArgumentHint?: string
  inlineGhostText?: InlineGhostText
  maxColumnWidth?: number
}

export function useTypeahead(_props: Record<string, unknown>): UseTypeaheadResult {
  return {
    suggestions: [],
    selectedSuggestion: 0,
    commandArgumentHint: undefined,
    inlineGhostText: undefined,
    maxColumnWidth: undefined,
  }
}
