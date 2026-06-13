// TODO: the plugin system (manifest parsing, marketplace, install status)
// lands with the plugin layer. The command types reference the manifest shape;
// only the open record is needed until then.

export type PluginManifest = {
  name?: string
  version?: string
  [key: string]: unknown
}
