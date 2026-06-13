// Analytics is intentionally not implemented: this build sends no telemetry.
// The exports keep call sites compiling so instrumented code paths work
// unchanged.

/** Metadata value attached to an event. Typed `never` so every call site must
 *  cast explicitly — the long name is a lint-time nudge to keep code and file
 *  paths out of event payloads. */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

// Event payloads carry booleans/numbers freely; strings must be cast through
// AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS so call sites
// affirm they hold no code or file paths.
type LogEventMetadata = { [key: string]: boolean | number | undefined }

export function logEvent(_event: string, _metadata?: LogEventMetadata): void {
  // no-op
}
