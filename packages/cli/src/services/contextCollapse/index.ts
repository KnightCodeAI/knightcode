// TODO: context-collapse is not implemented yet. It is a separate context
// management strategy gated behind a feature flag; compaction only consults
// these predicates inside dead-code-eliminated guards, so inert values keep
// the autocompact path on its default behavior.

export function isContextCollapseEnabled(): boolean {
  return false
}

export function resetContextCollapse(): void {}
