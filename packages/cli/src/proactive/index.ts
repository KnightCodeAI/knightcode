// TODO: autonomous/proactive mode is not implemented yet. The compaction prompt
// builder only checks this inside a dead-code-eliminated feature guard, so an
// inert false keeps the summary continuation message on its default wording.

export function isProactiveActive(): boolean {
  return false
}
