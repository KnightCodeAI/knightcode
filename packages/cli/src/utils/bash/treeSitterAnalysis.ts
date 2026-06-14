// TODO: tree-sitter AST analysis of shell commands is out of scope (native
// binding not bundled). These are the analysis result shapes the Bash tool's
// security validators reference as types; no analysis is produced at runtime
// (ParsedCommand.getTreeSitterAnalysis() returns null).

export type QuoteContext = {
  withDoubleQuotes: string
  fullyUnquoted: string
  unquotedKeepQuoteChars: string
}

export type CompoundStructure = {
  hasCompoundOperators: boolean
  hasPipeline: boolean
  hasSubshell: boolean
  hasCommandGroup: boolean
  operators: string[]
  segments: string[]
}

export type DangerousPatterns = {
  hasCommandSubstitution: boolean
  hasProcessSubstitution: boolean
  hasParameterExpansion: boolean
  hasHeredoc: boolean
  hasComment: boolean
}

export type TreeSitterAnalysis = {
  quoteContext: QuoteContext
  compoundStructure: CompoundStructure
  hasActualOperatorNodes: boolean
  dangerousPatterns: DangerousPatterns
}
