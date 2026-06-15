// Plugin user-config option storage. The persisted read/write of per-plugin
// option values lands with the plugin subsystem; until then no options are
// stored, so loads return an empty config. The pure ${user_config.*}
// substitution helper is real (used when expanding hook commands).

export type PluginOptionValues = { [key: string]: unknown }

// TODO: reading/merging persisted plugin option values lands with the plugin
// subsystem. With nothing stored, every plugin resolves to an empty config.
export function loadPluginOptions(_pluginId: string): PluginOptionValues {
  return {}
}

// Replace ${user_config.KEY} references in a string with the plugin's configured
// values. Throws if a referenced key is missing (validated upstream).
export function substituteUserConfigVariables(
  value: string,
  userConfig: PluginOptionValues,
): string {
  return value.replace(/\$\{user_config\.([^}]+)\}/g, (_match, key) => {
    const configValue = userConfig[key]
    if (configValue === undefined) {
      throw new Error(
        `Missing required user configuration value: ${key}. ` +
          `This should have been validated before variable substitution.`,
      )
    }
    return String(configValue)
  })
}
