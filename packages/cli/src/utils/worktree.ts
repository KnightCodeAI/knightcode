// TODO: git worktree sessions are out of scope for now. The statusline reads
// the current worktree session to show branch/path; with worktrees unwired
// there is never an active worktree session.

export type WorktreeSession = {
  worktreeName: string
  worktreePath: string
  worktreeBranch: string
  originalCwd: string
  originalBranch: string
  creationDurationMs?: number
  usedSparsePaths?: boolean
}

export function getCurrentWorktreeSession(): WorktreeSession | null {
  return null
}

export function restoreWorktreeSession(..._args: unknown[]): void {}
