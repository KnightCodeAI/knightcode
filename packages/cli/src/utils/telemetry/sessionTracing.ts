// TODO: tracing is not wired up; spans are inert.

export type Span = unknown

export type LLMRequestNewContext = {
  [key: string]: unknown
}

export function isBetaTracingEnabled(): boolean {
  return false
}

export function startLLMRequestSpan(
  _model: string,
  _newContext?: LLMRequestNewContext,
  _messagesForAPI?: unknown[],
  _fastMode?: boolean,
): Span {
  return null
}
