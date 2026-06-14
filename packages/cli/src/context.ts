// TODO: user-context assembly (CLAUDE.md discovery, directory context, git
// state) is not implemented yet. Compaction only clears this memoized loader's
// cache so the next turn rebuilds context; until the loader lands it resolves
// to an empty context.

import memoize from 'lodash-es/memoize.js'

export const getUserContext = memoize(
  async (): Promise<{ [k: string]: string }> => ({}),
)

// TODO: system-context assembly (git status, system-prompt injection) lands with
// the context loader; resolves to an empty context until then.
export const getSystemContext = memoize(
  async (): Promise<{ [k: string]: string }> => ({}),
)
