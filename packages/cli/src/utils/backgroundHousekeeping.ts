// Background housekeeping — deferred startup chores run once after the first
// turn. Most upstream chores (cleanup sweeps, plugin auto-update, deep-link
// registration, doc indexing) aren't ported; what runs here is the memory
// extraction system's one-time initialization so turn-end extraction works when
// opted in (KNIGHTCODE_AUTO_MEMORY_EXTRACTION).

import { initExtractMemories } from '../services/extractMemories/extractMemories.js'

export function startBackgroundHousekeeping(): void {
  initExtractMemories()
}
