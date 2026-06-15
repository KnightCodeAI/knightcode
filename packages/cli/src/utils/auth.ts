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
import { isEnvTruthy } from './envUtils.js'

export type ApiKeySource =
  | 'OPENROUTER_API_KEY'
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
export function getKnightcodeApiKeyWithSource(
  _opts: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): {
  key: null | string
  source: ApiKeySource
} {
  if (cachedResolution) return cachedResolution
  const envKey = process.env.OPENROUTER_API_KEY
  if (envKey) {
    cachedResolution = { key: envKey, source: 'OPENROUTER_API_KEY' }
    return cachedResolution
  }
  const fileKey = readCredentialsFileKey()
  cachedResolution = fileKey
    ? { key: fileKey, source: '/login managed key' }
    : { key: null, source: 'none' }
  return cachedResolution
}

export function getKnightcodeApiKey(): null | string {
  return getKnightcodeApiKeyWithSource().key
}

export function hasKnightcodeApiKeyAuth(): boolean {
  const { key, source } = getKnightcodeApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  return key !== null && source !== 'none'
}

/**
 * Whether the session uses first-party OAuth auth. A BYOK build always talks to
 * OpenRouter with an API key and never holds an OAuth session, so this is
 * always false — callers that gate KnightCode-account verification skip it, and
 * missing-key handling is surfaced separately at launch.
 */
export function isKnightcodeAuthEnabled(): boolean {
  return false
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

export type SubscriptionType = 'pro' | 'max' | 'team' | 'enterprise'

export function getSubscriptionType(): SubscriptionType | null {
  return null
}

export function isEnterpriseSubscriber(): boolean {
  return false
}

export function isProSubscriber(): boolean {
  return false
}

export function isMaxSubscriber(): boolean {
  return false
}

// Human-readable subscription label for the welcome footer. No hosted account
// in a BYOK build, so there is no subscription to name.
export function getSubscriptionName(): string {
  return ''
}

// macOS keychain / config-file API key lookup. BYOK reads the key from the
// environment only, so there is never a keychain/config-stored key.
export function getApiKeyFromConfigOrMacOSKeychain(): string | null {
  return null
}

// Which bearer-token source (if any) is in effect. No OAuth/token sources in a
// BYOK build, so there is none.
export function getAuthTokenSource(): { source: string; hasToken: boolean } {
  return { source: 'none', hasToken: false }
}

export function isTeamSubscriber(): boolean {
  return false
}

export function getKnightcodeAIOAuthTokens(): OAuthTokens | null {
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

// TODO: external apiKeyHelper support (a user-configured command that supplies
// the API key, with in-flight timing for the footer notice) and rate-limit-tier
// reporting are account/serving concerns not wired in a BYOK build. No helper is
// ever configured and there is no tier to report.
export function getConfiguredApiKeyHelper(): string | undefined {
  return undefined
}

export function getApiKeyHelperElapsedMs(): number {
  return 0
}

export function getRateLimitTier(): string | null {
  return null
}

// TODO: hosted subscription tiers don't apply to a BYOK build.
export function isTeamPremiumSubscriber(): boolean {
  return false
}

// TODO: hosted-account info is out of scope for a BYOK build.
export function getAccountInformation(): any { return undefined }
