// TODO: plugin command telemetry is an out-of-scope analytics subsystem. The
// Skill tool spreads these fields into its (inert) event payload; with no
// telemetry, they contribute nothing.

import type { PluginManifest } from '../../types/plugin.js'

export function buildPluginCommandTelemetryFields(
  _pluginInfo: { pluginManifest: PluginManifest; repository: string },
  _managedNames: Set<string> | null = null,
): Record<string, never> {
  return {}
}
