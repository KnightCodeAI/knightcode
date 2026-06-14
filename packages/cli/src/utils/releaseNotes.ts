// TODO: release-notes fetching (changelog download + cache) lands with the
// update subsystem; it pulls a network client. Until then the welcome screen
// shows no release notes.

export function getRecentReleaseNotesSync(_count: number): string[] {
  return []
}

export function checkForReleaseNotesSync(
  _lastSeenVersion: string | null | undefined,
  _currentVersion?: string,
): { hasReleaseNotes: boolean; releaseNotes: string[] } {
  return { hasReleaseNotes: false, releaseNotes: [] }
}

// The changelog is cached in the global config by the (deferred) fetcher; with
// no fetch wired there is nothing stored.
export function getStoredChangelogFromMemory(): string | null {
  return null
}

// Parse a raw changelog into version → notes. No changelog is ever stored, so
// this only needs to satisfy the type; it returns an empty map.
export function parseChangelog(_changelog: string): Record<string, string[]> {
  return {}
}
