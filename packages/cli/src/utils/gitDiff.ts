// TODO: per-file git-diff fetching (used to show a repo-relative patch after a
// write/edit) lands with the VCS integration. Until then no diff is computed.

export type ToolUseDiff = {
  filename: string
  status: 'modified' | 'added'
  additions: number
  deletions: number
  changes: number
  patch: string
  /** GitHub "owner/repo" when available (null for non-github.com or unknown repos) */
  repository: string | null
}

export async function fetchSingleFileGitDiff(
  _absoluteFilePath: string,
): Promise<ToolUseDiff | null> {
  return null
}
