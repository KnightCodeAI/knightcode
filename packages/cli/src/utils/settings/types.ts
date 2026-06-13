// TODO: the hooks settings schema (per-event hook command lists with matchers)
// lands with the hook execution layer. The command/settings types reference
// this shape; only the open record is needed until then.

export type HooksSettings = {
  [hookEvent: string]: unknown
}
