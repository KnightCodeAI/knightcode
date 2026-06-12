/**
 * BYOK credential resolution. The CLI talks to OpenRouter with a single API
 * key resolved from (in priority order) the OPENROUTER_API_KEY environment
 * variable or the credentials file at ~/.knightcode/credentials.json.
 *
 * Upstream auth concepts that don't exist in a BYOK build (OAuth sessions,
 * subscriber tiers, cloud-provider credential refresh) keep their call
 * signatures here so the API layer ports unchanged, but resolve to inert
 * values.
 *
 * SECURITY: never log or render key material from this module.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { safeParseJSON } from './json.js'

export type ApiKeySource =
  | 'ANTHROPIC_API_KEY'
  | 'apiKeyHelper'
  | '/login managed key'
  | 'none'

export type OAuthTokens = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

export type AccountInfo = {
  accountUuid?: string
  organizationUuid?: string
  emailAddress?: string
}

export function getConfigDir(): string {
  return (
    process.env.KNIGHTCODE_CONFIG_DIR ?? join(homedir(), '.knightcode')
  ).normalize('NFC')
}

function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json')
}

type Credentials = {
  openrouter?: {
    apiKey?: string
  }
}

let cachedResolution: { key: string | null; source: ApiKeySource } | null =
  null

function readCredentialsFileKey(): string | null {
  try {
    const raw = readFileSync(getCredentialsPath(), 'utf8')
    const parsed = safeParseJSON(raw, false) as Credentials | null
    const key = parsed?.openrouter?.apiKey
    return typeof key === 'string' && key.length > 0 ? key : null
  } catch {
    return null
  }
}

/**
 * Resolve the API key and where it came from. Environment keys report the
 * env-var source; keys saved by onboarding report the managed-key source so
 * error messaging can distinguish "fix your env var" from "re-run /login".
 */
export function getAnthropicApiKeyWithSource(
  _opts: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): {
  key: null | string
  source: ApiKeySource
} {
  if (cachedResolution) return cachedResolution
  const envKey = process.env.OPENROUTER_API_KEY
  if (envKey) {
    cachedResolution = { key: envKey, source: 'ANTHROPIC_API_KEY' }
    return cachedResolution
  }
  const fileKey = readCredentialsFileKey()
  cachedResolution = fileKey
    ? { key: fileKey, source: '/login managed key' }
    : { key: null, source: 'none' }
  return cachedResolution
}

export function getAnthropicApiKey(): null | string {
  return getAnthropicApiKeyWithSource().key
}

export function hasAnthropicApiKeyAuth(): boolean {
  const { key, source } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  return key !== null && source !== 'none'
}

/**
 * Persist the API key to the credentials file (creating the config dir on
 * first run) and reset the resolution cache so the new key takes effect in
 * this process immediately.
 */
export function saveCredentials(apiKey: string): void {
  mkdirSync(getConfigDir(), { recursive: true })
  const existing =
    (safeParseJSON(
      (() => {
        try {
          return readFileSync(getCredentialsPath(), 'utf8')
        } catch {
          return null
        }
      })(),
      false,
    ) as Credentials | null) ?? {}
  const next: Credentials = {
    ...existing,
    openrouter: { ...existing.openrouter, apiKey },
  }
  writeFileSync(getCredentialsPath(), JSON.stringify(next, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  clearApiKeyHelperCache()
}

/** Reset the key resolution cache (after key changes or auth errors). */
export function clearApiKeyHelperCache(): void {
  cachedResolution = null
}

export async function getApiKeyFromApiKeyHelper(
  _isNonInteractiveSession?: boolean,
): Promise<string | null> {
  return null
}

// ---------------------------------------------------------------------------
// Inert upstream-auth surface (no OAuth/subscriber/cloud-credential support).
// ---------------------------------------------------------------------------

export function isClaudeAISubscriber(): boolean {
  return false
}

export function isEnterpriseSubscriber(): boolean {
  return false
}

export function getClaudeAIOAuthTokens(): OAuthTokens | null {
  return null
}

export function getOauthAccountInfo(): AccountInfo | undefined {
  return undefined
}

export async function checkAndRefreshOAuthTokenIfNeeded(): Promise<void> {}

export async function handleOAuth401Error(
  _failedAccessToken: string,
): Promise<boolean> {
  return false
}

export function clearAwsCredentialsCache(): void {}

export function clearGcpCredentialsCache(): void {}

export async function refreshAndGetAwsCredentials(): Promise<null> {
  return null
}

export async function refreshGcpCredentialsIfNeeded(): Promise<void> {}
