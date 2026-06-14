// TODO: skills change detection (watch skill dirs, notify on add/remove) —
// owned by the skills feature. Local-only build does not yet watch skills,
// so subscription is inert and never fires.
function subscribe(_handler: () => void): () => void {
  return () => {}
}

function initialize(): void {}
function dispose(): void {}
function resetForTesting(): void {}

export const skillChangeDetector = {
  initialize,
  dispose,
  subscribe,
  resetForTesting,
}
