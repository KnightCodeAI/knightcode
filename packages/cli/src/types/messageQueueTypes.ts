/**
 * Types for the command-queue operation log. Kept dependency-free so the
 * session log types can import them without pulling in the queue manager.
 */

/** Operation performed on the unified command queue. */
export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | 'popAll'

/**
 * A queue operation as recorded in the session log. Lets resume reconstruct
 * what was queued (and never sent) when the session ended.
 */
export interface QueueOperationMessage {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: string
  content?: string
}
