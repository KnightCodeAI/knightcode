// TODO: git worktree sessions are out of scope for now. The statusline reads
// the current worktree session to show branch/path; with worktrees unwired
// there is never an active worktree session.

export type WorktreeSession = {
  worktreeName: string
  worktreePath: string
  worktreeBranch: string
  originalCwd: string
  originalBranch: string
  originalHeadCommit?: string
  sessionId: string
  tmuxSessionName?: string
  hookBased?: boolean
  creationDurationMs?: number
  usedSparsePaths?: boolean
}

export function getCurrentWorktreeSession(): WorktreeSession | null {
  return null
}

export function restoreWorktreeSession(..._args: unknown[]): void {}

// TODO: agent worktree isolation (creating/removing a per-agent git worktree)
// lands with the worktree runtime. Only reached when the model passes
// `isolation: "worktree"`; until the runtime lands, creation is unsupported and
// the change/removal helpers are inert.
export async function createAgentWorktree(_slug: string): Promise<{
  worktreePath: string
  worktreeBranch?: string
  headCommit?: string
  gitRoot?: string
  hookBased?: boolean
}> {
  throw new Error('Agent worktree isolation is not supported yet')
}

export async function hasWorktreeChanges(
  _worktreePath: string,
  _headCommit: string,
): Promise<boolean> {
  return false
}

export async function removeAgentWorktree(..._args: unknown[]): Promise<void> {}
