// TODO: the hooks settings schema (per-event hook command lists with matchers)
// lands with the hook execution layer. The command/settings types reference
// this shape; only the open record is needed until then.

// The full settings document. Aliased to the concrete Settings shape the
// settings loader returns (inline import avoids a top-level settings↔types
// cycle). TODO: swap to the real zod-inferred SettingsJson when the settings
// schema ports.
export type SettingsJson = import('./settings.js').Settings

export type HooksSettings = {
  [hookEvent: string]: unknown
}
