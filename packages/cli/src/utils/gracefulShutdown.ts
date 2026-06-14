// TODO: graceful shutdown (flushing pending writes, releasing the session lock,
// restoring the terminal) lands with the lifecycle phase. Until then shutdown
// is the minimal correct action: exit the process with the requested code.

export async function gracefulShutdown(
  code: number,
  _reason?: string,
): Promise<void> {
  process.exit(code)
}

export function gracefulShutdownSync(code: number): void {
  process.exit(code)
}
