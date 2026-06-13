// TODO: layered settings files (user/project/local) land with the settings
// phase; until then every read sees an empty settings object.

export type Settings = {
  alwaysThinkingEnabled?: boolean
  advisorModel?: string
  effortLevel?: 'low' | 'medium' | 'high' | 'max' | number
  [key: string]: unknown
}

export function getSettingsWithErrors(): {
  settings: Settings
  errors: unknown[]
} {
  return { settings: {}, errors: [] }
}

export function getInitialSettings(): Settings {
  return {}
}
