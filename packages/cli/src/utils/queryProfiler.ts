// TODO: the query profiler is not wired up.

export function queryCheckpoint(_label: string): void {}

export function endQueryProfile(): void {}

// Query profiling is inert (see neighbors); starting a profile is a no-op.
export function startQueryProfile(): void {}

export function logQueryProfileReport(..._args: unknown[]): void {}
