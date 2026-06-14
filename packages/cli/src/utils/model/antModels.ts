// TODO: Anthropic-internal ("ant"-build only) model list; dead branch in a BYOK
// build (USER_TYPE is never 'ant'). Inert stub returning no models.
export type AntModel = { alias: string; label: string; description?: string; model?: string }
export function getAntModels(): AntModel[] {
  return []
}
