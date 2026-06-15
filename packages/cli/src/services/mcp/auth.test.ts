import { describe, expect, it } from 'bun:test'
import { getServerKey } from './auth.js'
import { isXaaEnabled } from './xaaIdpLogin.js'
import { performCrossAppAccess } from './xaa.js'

describe('getServerKey', () => {
  it('derives a stable server-scoped key from server identity', () => {
    const config = { type: 'http' as const, url: 'https://mcp.example.com/sse' }
    const a = getServerKey('example', config)
    const b = getServerKey('example', config)
    expect(a).toBe(b)
    expect(a.startsWith('example|')).toBe(true)
  })

  it('changes the key when the server URL changes', () => {
    const a = getServerKey('example', {
      type: 'http' as const,
      url: 'https://a.example.com',
    })
    const b = getServerKey('example', {
      type: 'http' as const,
      url: 'https://b.example.com',
    })
    expect(a).not.toBe(b)
  })
})

describe('Cross-App Access (enterprise managed auth) is inert', () => {
  it('reports XAA disabled', () => {
    expect(isXaaEnabled()).toBe(false)
  })

  it('refuses the cross-app exchange rather than performing it', async () => {
    await expect(
      performCrossAppAccess('https://mcp.example.com', {
        clientId: 'c',
        idpClientId: 'i',
        idpIdToken: 't',
        idpTokenEndpoint: 'https://idp.example.com/token',
      }),
    ).rejects.toThrow()
  })
})
