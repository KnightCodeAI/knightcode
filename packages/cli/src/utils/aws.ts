// TODO: Bedrock credential refresh is not supported in the BYOK build; only
// the error predicate the retry layer consults lives here.

type AwsError = {
  name?: string
}

export function isAwsCredentialsProviderError(err: unknown): boolean {
  return (err as AwsError | undefined)?.name === 'CredentialsProviderError'
}
