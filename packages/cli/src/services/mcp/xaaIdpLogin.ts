// TODO: enterprise managed MCP auth (Cross-App Access) IdP login is not ported.
// Acquiring an id_token from a managed identity provider requires enterprise
// IdP infrastructure outside a BYOK build. Inert: XAA is reported disabled, so
// the discovery/login functions are never reached; they fail loudly if forced.

export type XaaIdpSettings = {
  issuer: string
  clientId: string
  callbackPort?: number
}

export type IdpLoginOptions = {
  idpIssuer: string
  idpClientId: string
  idpClientSecret?: string
  callbackPort?: number
  onAuthorizationUrl?: (url: string) => void
  skipBrowserOpen?: boolean
  abortSignal?: AbortSignal
}

export function isXaaEnabled(): boolean {
  return false
}

export function getXaaIdpSettings(): XaaIdpSettings | undefined {
  return undefined
}

export function getCachedIdpIdToken(_idpIssuer: string): string | undefined {
  return undefined
}

export function clearIdpIdToken(_idpIssuer: string): void {}

export function getIdpClientSecret(_idpIssuer: string): string | undefined {
  return undefined
}

export async function discoverOidc(
  _idpIssuer: string,
): Promise<{ token_endpoint: string }> {
  throw new Error('Enterprise managed MCP auth (XAA) is not supported')
}

export async function acquireIdpIdToken(_opts: IdpLoginOptions): Promise<string> {
  throw new Error('Enterprise managed MCP auth (XAA) is not supported')
}
