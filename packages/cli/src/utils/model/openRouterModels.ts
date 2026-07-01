import { existsSync, writeFileSync, readFileSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { getKnightcodeConfigHomeDir } from '../envUtils.js'
import { getKnightcodeApiKey } from '../auth.js'
import { getUserAgent } from '../http.js'

export type OpenRouterModel = {
  id: string                 // "google/gemini-2.5-flash"
  name: string               // "Gemini 2.5 Flash"
  contextLength: number      // 200000
  maxCompletionTokens?: number   // top_provider.max_completion_tokens
  authorSlug: string             // id.split('/')[0], e.g. "nvidia"
  pricing: { prompt: number; completion: number }  // USD per token (from API)
  inputModalities: string[]  // architecture.input_modalities, e.g. ["text","image"]
  supportsTools: boolean     // supported_parameters includes "tools"
  supportsReasoning: boolean // supported_parameters includes "reasoning"
  supportedParameters: string[]  // raw supported_parameters list
}

// In-memory memo for the process lifetime.
let memoizedModels: OpenRouterModel[] | null = null

function getCachePath(): string {
  const cacheDir = join(getKnightcodeConfigHomeDir(), 'cache')
  return join(cacheDir, 'openrouter-models.json')
}

export function getOpenRouterModel(id: string): OpenRouterModel | undefined {
  if (!memoizedModels) {
    // Not fetched yet (e.g. effort resolution on the request path before the
    // picker has opened). Load the disk cache synchronously as a one-time
    // fallback; the async fetch path keeps the memo warm thereafter.
    try {
      const cacheFile = getCachePath()
      if (existsSync(cacheFile)) {
        const parsed = JSON.parse(readFileSync(cacheFile, 'utf-8'))
        if (Array.isArray(parsed)) {
          memoizedModels = parsed
        }
      }
    } catch {
      // Corrupt/unreadable cache — treat as no data.
    }
  }
  return memoizedModels?.find(m => m.id === id)
}

export async function getOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (memoizedModels) {
    return memoizedModels
  }

  const cacheFile = getCachePath()
  const cacheTTL = 60 * 60 * 1000 // 1 hour

  // Try to load from disk cache if it is fresh
  if (existsSync(cacheFile)) {
    try {
      const stats = statSync(cacheFile)
      if (Date.now() - stats.mtimeMs < cacheTTL) {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'))
        if (Array.isArray(cached) && cached.length > 0) {
          memoizedModels = cached
          return cached
        }
      }
    } catch (e) {
      // Fail silently and fetch
    }
  }

  // Fetch from OpenRouter API
  try {
    const apiKey = getKnightcodeApiKey()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getUserAgent(),
      'HTTP-Referer': 'https://knightcode.raghavseth.in',
      'X-Title': 'KnightCode',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
    })

    if (!response.ok) {
      throw new Error(`OpenRouter API responded with status ${response.status}`)
    }

    const data = await response.json()
    if (!data || !Array.isArray(data.data)) {
      throw new Error('Invalid response shape from OpenRouter models API')
    }

    const normalized: OpenRouterModel[] = data.data.map((m: any) => {
      const supportedParams = m.supported_parameters || []
      const inputModalities = m.architecture?.input_modalities || ['text']
      const promptPricing = parseFloat(m.pricing?.prompt || '0')
      const completionPricing = parseFloat(m.pricing?.completion || '0')

      return {
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length || 0,
        maxCompletionTokens: m.top_provider?.max_completion_tokens ?? undefined,
        authorSlug: String(m.id || '').split('/')[0] || '',
        pricing: {
          prompt: promptPricing,
          completion: completionPricing,
        },
        inputModalities,
        supportsTools: supportedParams.includes('tools'),
        supportsReasoning: supportedParams.includes('reasoning'),
        supportedParameters: Array.isArray(supportedParams) ? supportedParams : [],
      }
    })

    // Save to disk cache
    try {
      const cacheDir = join(getKnightcodeConfigHomeDir(), 'cache')
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true })
      }
      writeFileSync(cacheFile, JSON.stringify(normalized, null, 2), 'utf-8')
    } catch (e) {
      // Ignore write errors
    }

    memoizedModels = normalized
    return normalized
  } catch (err) {
    // On fetch failure, fall back to stale disk cache if it exists
    if (existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'))
        if (Array.isArray(cached) && cached.length > 0) {
          memoizedModels = cached
          return cached
        }
      } catch (e) {
        // Ignore read errors
      }
    }
    throw err
  }
}

export function formatContextLength(n: number): string {
  if (n >= 1000000) {
    return `${Math.round(n / 1000000)}M`
  }
  if (n >= 1000) {
    return `${Math.round(n / 1000)}K`
  }
  return String(n)
}

export function formatPricing(p: { prompt: number; completion: number }): string {
  // OpenRouter prices are USD per token; show USD per 1M tokens. Sub-cent
  // rates (e.g. cheap models at $0.05/M) need more precision than 2 decimals.
  const formatNum = (perToken: number): string => {
    const perMillion = perToken * 1_000_000
    if (perMillion === 0) return '$0.00'
    if (perMillion < 1) return `$${perMillion.toFixed(3)}`
    return `$${perMillion.toFixed(2)}`
  }
  return `${formatNum(p.prompt)}/${formatNum(p.completion)}`
}

/** Supported request parameters for a model (empty set if unknown). */
export function getModelSupportedParameters(id: string): Set<string> {
  return new Set(getOpenRouterModel(id)?.supportedParameters ?? [])
}

/**
 * Test-only seam: pin the in-memory catalog. Pass a models array to simulate a
 * warm catalog ([] = warm but empty — no disk fallback), or null to reset to
 * the cold state (next read falls back to the disk cache). Tests must use this
 * instead of mock.module: bun module mocks are process-global and cannot be
 * reliably restored for already-linked importers, so they poison every test
 * file that runs later in the same process.
 */
export function setModelCatalogForTests(models: OpenRouterModel[] | null): void {
  memoizedModels = models
}

/**
 * Fire-and-forget catalog warm for startup. Populates the in-memory + disk
 * cache so context sizing and model profiles have real data without the user
 * opening the model picker. Never throws.
 */
export function warmModelCatalog(): void {
  void getOpenRouterModels().catch(() => {
    /* offline / no key — disk snapshot or defaults are used downstream */
  })
}
