/** Reserve at least this many output tokens for the final answer when
 *  reasoning is enabled, so reasoning never starves the completion. */
export const MIN_COMPLETION_FLOOR = 4096

export type Sampling = {
  temperature?: number
  topP?: number
  topK?: number
}

/** How to ask THIS model to reason. */
export type ReasoningStrategy =
  | { kind: 'anthropic-adaptive' }
  | { kind: 'anthropic-budget'; budgetTokens: number }
  | { kind: 'openrouter-effort' }
  | { kind: 'enable-flag'; body: Record<string, unknown> }
  | { kind: 'none' }

/** Pure tool-schema rewrite (e.g. Gemini int→string enums). */
export type SchemaTransform = (schema: any) => any
/** Pure message-array rewrite (e.g. DeepSeek reasoning blocks). */
export type MessageTransform = (messages: any[]) => any[]

export type ModelProfile = {
  id: string
  // capability (from catalog; undefined when catalog is cold)
  contextLength?: number
  maxOutputTokens?: number
  supportsReasoning: boolean
  supportsTools: boolean
  supportedParameters: ReadonlySet<string>
  // quirks
  sampling: Sampling
  reasoning: ReasoningStrategy
  extraBody: Record<string, unknown>
  schemaTransforms: SchemaTransform[]
  messageTransforms: MessageTransform[]
}
