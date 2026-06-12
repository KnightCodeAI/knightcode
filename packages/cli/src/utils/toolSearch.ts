// TODO: the deferred-tool search layer (tool_reference expansion, context
// scoring, beta gating) lands with the tool layer; only the block predicate
// the message utilities need lives here for now.

/**
 * Check if an object is a tool_reference block.
 * tool_reference is a beta feature not in the SDK types, so we need runtime checks.
 */
export function isToolReferenceBlock(obj: unknown): boolean {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    (obj as { type: unknown }).type === 'tool_reference'
  )
}
