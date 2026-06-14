// Heredoc extraction (replacing `<< EOF ... EOF` bodies with placeholders so
// the security scanners don't treat heredoc content as command syntax). This is
// pure string scanning — no tree-sitter — but the full incremental scanner is
// not ported; the inert version passes the command through untouched.
// TODO: port the full heredoc scanner when the bash analysis layer lands.

export type HeredocInfo = {
  fullText: string
  delimiter: string
  operatorStartIndex: number
  operatorEndIndex: number
  [key: string]: unknown
}

export type HeredocExtractionResult = {
  /** The command with heredocs replaced by placeholders. */
  processedCommand: string
  /** Map of placeholder string to original heredoc info. */
  heredocs: Map<string, HeredocInfo>
}

export function extractHeredocs(
  command: string,
  _options?: { quotedOnly?: boolean },
): HeredocExtractionResult {
  // Inert: leave the command unchanged. Security scanners then see the raw
  // command (fail-safe) rather than a placeholder-substituted form.
  return { processedCommand: command, heredocs: new Map() }
}
