// Analytics is intentionally not implemented: this build sends no telemetry.
// The exports keep call sites compiling so instrumented code paths work
// unchanged.

/** Metadata value attached to an event. The long name is a lint-time nudge
 *  at call sites to keep code and file paths out of event payloads. */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS =
  | string
  | number
  | boolean
  | undefined

export function logEvent(
  _event: string,
  _metadata?: Record<
    string,
    AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  >,
): void {
  // no-op
}
