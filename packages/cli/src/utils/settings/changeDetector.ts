// TODO: live settings change detection (watches the settings files on disk and
// fans out to subscribers so the running session picks up edits) lands with the
// settings subsystem. Inert today: it registers subscribers but never fires, so
// settings are read once at startup and not hot-reloaded.

import type { SettingSource } from './constants.js'

type ChangeHandler = (source: SettingSource) => void

const subscribers = new Set<ChangeHandler>()

async function initialize(): Promise<void> {}

function dispose(): Promise<void> {
  subscribers.clear()
  return Promise.resolve()
}

function subscribe(handler: ChangeHandler): () => void {
  subscribers.add(handler)
  return () => subscribers.delete(handler)
}

function notifyChange(source: SettingSource): void {
  for (const handler of subscribers) handler(source)
}

function resetForTesting(): void {
  subscribers.clear()
}

export const settingsChangeDetector = {
  initialize,
  dispose,
  subscribe,
  notifyChange,
  resetForTesting,
}
