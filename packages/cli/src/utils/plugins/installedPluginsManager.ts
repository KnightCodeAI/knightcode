// TODO: the plugin manager (installed_plugins.json) lands with the plugins
// phase. No plugins are installed yet, so the registry is empty.

export type InstalledPluginsV2 = {
  plugins: Record<string, unknown>
}

export function loadInstalledPluginsV2(): InstalledPluginsV2 {
  return { plugins: {} }
}
