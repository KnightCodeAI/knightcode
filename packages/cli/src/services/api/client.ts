import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { getSessionId } from '../../bootstrap/state.js'
import { getAnthropicApiKey } from '../../utils/auth.js'
import { getUserAgent } from '../../utils/http.js'
import { getProxyFetchOptions } from '../../utils/proxy.js'

/**
 * The model gateway speaks the Anthropic Messages protocol natively, so the
 * SDK client is pointed at it directly — streaming, tool use, and beta
 * params work unchanged for both Anthropic and non-Anthropic models.
 *
 * Environment variables:
 * - OPENROUTER_API_KEY: API key (or save one via onboarding)
 * - OPENROUTER_BASE_URL: override the gateway origin (e.g. a local proxy);
 *   the SDK appends /v1/messages to this base
 * - API_TIMEOUT_MS: per-request timeout override
 */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api'

function getBaseURL(): string {
  return process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL
}

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model: _model,
  fetchOverride,
  source: _source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}): Promise<Anthropic> {
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
    // Attribution headers the gateway uses to identify the calling app.
    'X-Title': 'KnightCode',
  }

  const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey: apiKey || getAnthropicApiKey(),
    baseURL: getBaseURL(),
    defaultHeaders,
    maxRetries,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    fetchOptions: getProxyFetchOptions({
      forAnthropicAPI: true,
    }) as ClientOptions['fetchOptions'],
    ...(fetchOverride && { fetch: fetchOverride }),
  }

  return new Anthropic(clientConfig)
}
