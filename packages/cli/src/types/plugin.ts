// TODO: the plugin system (manifest parsing, marketplace, install status,
// loaded-plugin registry) lands with the plugin layer. AppState holds plugin
// registries (all empty today), so the shapes are modelled loosely here until
// the real manifest/schema types port.

import type { HooksSettings } from '../utils/settings/types.js'

export type PluginAuthor = {
  name?: string
  email?: string
  url?: string
  [key: string]: unknown
}

export type PluginManifest = {
  name?: string
  version?: string
  author?: PluginAuthor
  [key: string]: unknown
}

export type CommandMetadata = {
  [key: string]: unknown
}

export type PluginComponent =
  | 'commands'
  | 'agents'
  | 'skills'
  | 'hooks'
  | 'output-styles'

export type LoadedPlugin = {
  name: string
  manifest: PluginManifest
  path: string
  source: string
  repository: string
  enabled?: boolean
  isBuiltin?: boolean
  sha?: string
  commandsPath?: string
  commandsPaths?: string[]
  commandsMetadata?: Record<string, CommandMetadata>
  agentsPath?: string
  agentsPaths?: string[]
  skillsPath?: string
  skillsPaths?: string[]
  outputStylesPath?: string
  outputStylesPaths?: string[]
  hooksConfig?: HooksSettings
  mcpServers?: Record<string, unknown>
  lspServers?: Record<string, unknown>
  settings?: Record<string, unknown>
}

export type PluginError = {
  type: string
  source: string
  plugin?: string
  [key: string]: unknown
}
