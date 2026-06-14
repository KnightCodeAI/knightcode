// TODO: the upstream table maps each model key to per-provider id variants
// (firstParty/Bedrock/Vertex/Foundry) with remote overrides; the BYOK build
// speaks one gateway, so a static table of gateway model ids suffices until
// the /model phase lands.

export type ModelStrings = {
  haiku35: string
  haiku45: string
  sonnet40: string
  sonnet45: string
  sonnet46: string
  opus40: string
  opus41: string
  opus45: string
  opus46: string
}

const GATEWAY_MODEL_STRINGS: ModelStrings = {
  haiku35: 'anthropic/claude-3.5-haiku',
  haiku45: 'anthropic/claude-haiku-4.5',
  sonnet40: 'anthropic/claude-sonnet-4',
  sonnet45: 'anthropic/claude-sonnet-4.5',
  sonnet46: 'anthropic/claude-sonnet-4.6',
  opus40: 'anthropic/claude-opus-4',
  opus41: 'anthropic/claude-opus-4.1',
  opus45: 'anthropic/claude-opus-4.5',
  opus46: 'anthropic/claude-opus-4.6',
}

export function getModelStrings(): ModelStrings {
  return GATEWAY_MODEL_STRINGS
}

// TODO: per-provider model-id overrides (e.g. Bedrock ARNs) aren't part of a
// BYOK gateway build; the id is used as-is.
export function resolveOverriddenModel(modelId: string): string {
  return modelId
}
