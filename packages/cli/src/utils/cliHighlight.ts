// TODO: terminal syntax highlighting (cli-highlight / highlight.js) is not a
// dependency yet. The only consumer here is the telemetry language-name lookup,
// which is non-blocking; until the highlighter is wired up it reports the file
// extension, or "unknown" when there is none.

import { extname } from 'path'

// Structural shape of the cli-highlight surface the markdown renderer consumes.
// Typed structurally (not `typeof import('cli-highlight')`) so we don't depend
// on that package at the type level.
export type CliHighlight = {
  highlight: (
    code: string,
    options?: {
      language?: string
      ignoreIllegals?: boolean
      theme?: unknown
    },
  ) => string
  supportsLanguage: (language: string) => boolean
}

/**
 * TODO: terminal syntax highlighting (cli-highlight) is not wired yet. Returning
 * null makes the markdown renderer emit code blocks as plain text — the same
 * graceful path it takes when the highlighter fails to load. When the
 * highlighter lands, this resolves to a real CliHighlight.
 */
let cliHighlightPromise: Promise<CliHighlight | null> | undefined

export function getCliHighlightPromise(): Promise<CliHighlight | null> {
  // Cached so React's `use()` gets a stable promise across renders.
  cliHighlightPromise ??= Promise.resolve(null)
  return cliHighlightPromise
}

/**
 * eg. "foo/bar.ts" → "ts". Used only for telemetry attributes (OTel counter
 * attributes, permission-dialog events); callers fire-and-forget.
 */
export async function getLanguageName(file_path: string): Promise<string> {
  const ext = extname(file_path).slice(1)
  return ext || 'unknown'
}
