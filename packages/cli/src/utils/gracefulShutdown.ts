// TODO: graceful shutdown (flushing pending writes, releasing the session lock,
// restoring the terminal) lands with the lifecycle phase. Until then shutdown
// is the minimal correct action: exit the process with the requested code.

let shutdownInProgress = false

export async function gracefulShutdown(
  code: number,
  _reason?: string,
): Promise<void> {
  shutdownInProgress = true
  process.exit(code)
}

export function gracefulShutdownSync(code = 0, _reason?: string): void {
  shutdownInProgress = true
  process.exit(code)
}

/** Check if graceful shutdown is in progress. */
export function isShuttingDown(): boolean {
  return shutdownInProgress
}
