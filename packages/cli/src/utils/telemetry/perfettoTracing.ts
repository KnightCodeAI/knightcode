// TODO: Perfetto/Chrome trace-event instrumentation. Inert: tracing is an
// out-of-scope telemetry subsystem, so this records nothing. Replace with a
// real tracer if/when trace export is reintroduced.

export function isPerfettoTracingEnabled(): boolean {
  return false
}

export function registerAgent(
  _agentId: string,
  _agentName: string,
  _parentAgentId?: string,
): void {}

export function unregisterAgent(_agentId: string): void {}
