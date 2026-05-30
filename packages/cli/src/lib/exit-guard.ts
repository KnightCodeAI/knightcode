/**
 * Intentional-exit flag for the Ctrl+C double-press guard.
 *
 * Must be imported before createCliRenderer.
 *
 * Call markIntentionalExit() immediately before any renderer.destroy() that
 * should always go through (e.g. /exit command). The guard in index.tsx checks
 * this to let confirmed/explicit exits bypass the double-press logic.
 */

let _intentional = false;

/** Mark the next destroy() as intentional — bypasses the double-press guard. */
export function markIntentionalExit(): void {
  _intentional = true;
}

/** Whether an intentional exit has been requested. */
export function isIntentionalExit(): boolean {
  return _intentional;
}
