import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

// KnightCode talks to a single provider (OpenRouter). The provider-routing
// concept is collapsed to one path; the legacy enum is retained only so the
// remaining display/telemetry call sites keep type-checking.
export function getAPIProvider(): APIProvider {
  return 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}
