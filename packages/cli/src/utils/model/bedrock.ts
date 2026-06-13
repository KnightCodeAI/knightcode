// TODO: Bedrock inference profiles are not supported in the BYOK build.

/** Returns the backing model id for a Bedrock inference profile ARN. */
export function getInferenceProfileBackingModel(model: string): string {
  return model
}
