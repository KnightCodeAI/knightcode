// TODO: the plugin system isn't ported. Glob consults this for directories to
// exclude from results (stale plugin caches); with no plugins there is nothing
// to exclude, so both functions are inert until the plugin layer lands.

export async function getGlobExclusionsForPluginCache(
  _searchDir: string,
): Promise<string[]> {
  return []
}

export function clearPluginCacheExclusions(): void {}
