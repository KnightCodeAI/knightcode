// The v2 task framework (TaskCreate/Get/Update/List) is deferred, so v2 is not
// enabled and TodoWrite remains the active session checklist. When the task
// framework lands this gate flips to the real interactive/SDK detection and the
// richer task utilities move here.
export function isTodoV2Enabled(): boolean {
  return false
}
