import type { Theme } from '../../utils/theme.js'

export interface TipContext {
  theme?: any
  readFileState?: unknown
  bashTools?: ReadonlySet<string>
}

export interface Tip {
  id: string
  content: (opts: { theme: any }) => Promise<string> | string
}
