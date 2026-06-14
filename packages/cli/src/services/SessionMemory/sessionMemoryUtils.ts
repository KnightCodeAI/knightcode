// TODO: session memory is not implemented yet. Compaction records the last
// summarized message id here so the next compaction knows where to resume;
// until the subsystem lands this is an inert setter.

export function setLastSummarizedMessageId(_messageId: string | undefined): void {}

// Loaded session-memory content for the current session. The session-memory
// subsystem isn't wired yet, so there is none to surface.
export async function getSessionMemoryContent(): Promise<string | null> {
  return null
}
