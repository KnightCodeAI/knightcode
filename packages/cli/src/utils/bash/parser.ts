// TODO: the tree-sitter bash parser is out of scope (native binding not
// bundled). These carry the node type and abort sentinel the Bash tool's
// command helpers reference; parsing is unavailable, so callers take their
// regex/static fallback path.

// Opaque tree-sitter node — the real binding types this; here it is unknown.
export type Node = unknown

// Sentinel returned when a parse is aborted (e.g. signal fired). Distinct from
// `null` (no parse) so callers can tell "aborted" from "unparseable".
export const PARSE_ABORTED = Symbol('parse-aborted')

// Without the tree-sitter binding there is no raw parse; report aborted/none.
export async function parseCommandRaw(
  _command: string,
  _signal?: AbortSignal,
): Promise<Node | typeof PARSE_ABORTED | null> {
  return null
}
