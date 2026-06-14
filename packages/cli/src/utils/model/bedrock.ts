// TODO: AWS Bedrock provider is out of scope; region-prefix helpers are inert.
export function getBedrockRegionPrefix(_region?: string): string { return '' }
export function applyBedrockRegionPrefix(modelId: string, _region?: string): string { return modelId }
export function getInferenceProfileBackingModel(modelId: string): string { return modelId }
