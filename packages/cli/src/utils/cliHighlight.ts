// TODO: terminal syntax highlighting (cli-highlight / highlight.js) is not a
// dependency yet. The only consumer here is the telemetry language-name lookup,
// which is non-blocking; until the highlighter is wired up it reports the file
// extension, or "unknown" when there is none.

import { extname } from 'path'

/**
 * eg. "foo/bar.ts" → "ts". Used only for telemetry attributes (OTel counter
 * attributes, permission-dialog events); callers fire-and-forget.
 */
export async function getLanguageName(file_path: string): Promise<string> {
  const ext = extname(file_path).slice(1)
  return ext || 'unknown'
}
