import { getSettingValue } from "../../settings";

/**
 * Skill auto-discovery (side-query nudging) is on by default. It only spends a
 * side query when there are eligible, not-yet-nudged skills, so "on" is cheap;
 * users opt out with `skills.autoDiscover: false`.
 */
export function isSkillAutoDiscoverEnabled(): boolean {
  return getSettingValue("skills.autoDiscover") !== false;
}

/**
 * Hot-reloading skill dirs (chokidar) is on by default. Disable with
 * `skills.hotReload: false` in environments where the watcher misbehaves.
 */
export function isSkillHotReloadEnabled(): boolean {
  return getSettingValue("skills.hotReload") !== false;
}
