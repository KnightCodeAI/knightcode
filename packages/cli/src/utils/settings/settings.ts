// TODO: layered settings files (user/project/local) land with the settings
// phase; until then every read sees an empty settings object.

export type Settings = {
  alwaysThinkingEnabled?: boolean
  [key: string]: unknown
}

export function getSettingsWithErrors(): {
  settings: Settings
  errors: unknown[]
} {
  return { settings: {}, errors: [] }
}
