// TODO: enterprise managed MCP auth (Cross-App Access / SEP-990) is not ported.
// It chains an enterprise IdP token-exchange to obtain an MCP token without a
// browser consent screen — it requires managed IdP infrastructure this BYOK
// build has no part of. Inert: XAA is reported disabled (see xaaIdpLogin), so
// these are never reached; if a config forces the path they fail loudly.

export class XaaTokenExchangeError extends Error {
  readonly shouldClearIdToken: boolean
  constructor(message: string, shouldClearIdToken: boolean) {
    super(message)
    this.name = 'XaaTokenExchangeError'
    this.shouldClearIdToken = shouldClearIdToken
  }
}

export type XaaConfig = {
  clientId: string
  clientSecret?: string
  idpClientId: string
  idpClientSecret?: string
  idpIdToken: string
  idpTokenEndpoint: string
}

export type XaaResult = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  /** AS issuer URL discovered via PRM; persisted for refresh/revocation. */
  authorizationServerUrl: string
}

export async function performCrossAppAccess(
  _serverUrl: string,
  _config: XaaConfig,
  _serverName = 'xaa',
  _abortSignal?: AbortSignal,
): Promise<XaaResult> {
  throw new XaaTokenExchangeError(
    'Cross-App Access (enterprise managed MCP auth) is not supported',
    false,
  )
}
