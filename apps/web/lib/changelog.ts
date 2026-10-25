import {
  getChangelog,
  isUnreleased,
  type ChangeKind,
  type ChangelogEntry,
  type Product,
} from "./changelog-parser"

export type { ChangeKind, ChangelogEntry, Product }

export { getChangelog, isUnreleased }
