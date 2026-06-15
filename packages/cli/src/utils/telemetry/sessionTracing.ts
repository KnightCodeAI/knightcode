// TODO: tracing is not wired up; spans are inert.

export type Span = unknown

export function startToolSpan(
  _toolName: string,
  _toolAttributes?: Record<string, string | number | boolean>,
  _toolInput?: string,
): Span {
  return null
}

export function startToolBlockedOnUserSpan(): Span {
  return null
}

export function endToolBlockedOnUserSpan(
  _decision?: string,
  _source?: string,
): void {}

export function startToolExecutionSpan(): Span {
  return null
}

export function endToolExecutionSpan(_metadata?: {
  success?: boolean
  error?: string
}): void {}

export function endToolSpan(_toolResult?: string, _resultTokens?: number): void {}

// Hook execution tracing. Inert: tracing is an out-of-scope telemetry subsystem.
export function startHookSpan(
  _hookEvent: string,
  _hookName: string,
  _numHooks: number,
  _hookDefinitions: string,
): Span {
  return null
}
export function endHookSpan(
  _span: Span,
  _metadata?: {
    numSuccess?: number
    numBlocking?: number
    numNonBlockingError?: number
    numCancelled?: number
  },
): void {}

export function addToolContentEvent(
  _eventName: string,
  _attributes: Record<string, string | number | boolean>,
): void {}

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

// TODO: per-interaction tracing spans belong to telemetry (out of scope). Return
// the inert Span sentinel so callers can hold a span handle that does nothing.
export function startInteractionSpan(_userPrompt: string): Span {
  return undefined
}

export function endInteractionSpan(..._args: unknown[]): void {}
