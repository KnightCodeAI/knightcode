import { getSettingValue } from "../settings";

/**
 * Auto-memory is on by default. It only ever does work when memory files exist
 * (recall) or a turn completes (extraction), so "on" is safe; users opt out by
 * setting `memory.enabled` to false.
 */
export function isMemoryEnabled(): boolean {
  return getSettingValue("memory.enabled") !== false;
}
