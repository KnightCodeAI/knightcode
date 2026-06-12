// TODO: only the persisted-record type lives here so the log types compile;
// the storage/budgeting implementation lands with the tool execution layer.

/**
 * Records a tool-result content replacement (large output swapped for a
 * placeholder) so session resume can reconstruct the original transcript.
 */
export type ContentReplacementRecord = {
  kind: 'tool-result'
  toolUseId: string
  replacement: string
}
