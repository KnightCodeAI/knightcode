// Loop control markers for the query loop. `Continue` records why the previous
// iteration looped again (carried on State.transition so tests can assert which
// recovery path fired); `Terminal` is the loop's final outcome, returned by
// query().

export interface Continue {
  reason: string
  /** Messages committed to disk by a context-collapse drain. */
  committed?: number
  /** Max-output-tokens recovery attempt number. */
  attempt?: number
}

export interface Terminal {
  reason: string
  /** Underlying error for the 'model_error' outcome. */
  error?: unknown
  /** Turn count for the 'max_turns' outcome. */
  turnCount?: number
}
