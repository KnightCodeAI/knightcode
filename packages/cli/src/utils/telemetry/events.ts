// TODO: third-party OpenTelemetry event export is not implemented yet. Until a
// logger provider is wired up there is nothing to emit to, so this is inert.

export async function logOTelEvent(
  _eventName: string,
  _metadata: { [key: string]: string | undefined } = {},
): Promise<void> {}
