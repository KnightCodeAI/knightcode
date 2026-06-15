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

// Where the full changelog lives, shown as a fallback when no notes are cached.
export const CHANGELOG_URL =
  'https://github.com/knightcode/knightcode-code/blob/main/CHANGELOG.md'

// The fetcher (network client) lands with the update subsystem; until then
// /release-notes downloads nothing and falls back to the changelog link.
export async function fetchAndStoreChangelog(): Promise<void> {}

export async function getStoredChangelog(): Promise<string> {
  return ''
}

export function getAllReleaseNotes(
  _changelog: string,
): Array<[string, string[]]> {
  return []
}
