import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../../tools.js'
import { isPreapprovedHost, PREAPPROVED_HOSTS } from './preapproved.js'
import { WEB_FETCH_TOOL_NAME } from './prompt.js'
import {
  isPermittedRedirect,
  isPreapprovedUrl,
  validateURL,
} from './utils.js'
import { WebFetchTool } from './WebFetchTool.js'

describe('isPreapprovedHost', () => {
  test('matches an exact hostname-only entry', () => {
    expect(isPreapprovedHost('docs.python.org', '/3/library/os.html')).toBe(
      true,
    )
  })

  test('rejects a host not in the list', () => {
    expect(isPreapprovedHost('evil.example.com', '/')).toBe(false)
  })

  test('matches a path-scoped entry only at a segment boundary', () => {
    // vercel.com/docs is the lone path-scoped preapproved entry.
    expect(isPreapprovedHost('vercel.com', '/docs')).toBe(true)
    expect(isPreapprovedHost('vercel.com', '/docs/frameworks')).toBe(true)
    // Must not match a sibling prefix that merely starts with the same chars.
    expect(isPreapprovedHost('vercel.com', '/docs-evil/malware')).toBe(false)
    // The bare host without the path prefix is not preapproved.
    expect(isPreapprovedHost('vercel.com', '/pricing')).toBe(false)
  })

  test('every path-scoped entry is keyed on a host without a bare entry', () => {
    // Sanity: path-scoped entries should still be parsed as host+path, never
    // accidentally registered as a hostname-only match.
    expect(PREAPPROVED_HOSTS.has('vercel.com/docs')).toBe(true)
    expect(isPreapprovedHost('vercel.com/docs', '/')).toBe(false)
  })
})

describe('isPreapprovedUrl', () => {
  test('true for a preapproved doc host', () => {
    expect(isPreapprovedUrl('https://react.dev/learn')).toBe(true)
  })

  test('false for a non-preapproved host', () => {
    expect(isPreapprovedUrl('https://example.com/page')).toBe(false)
  })

  test('false for a malformed URL', () => {
    expect(isPreapprovedUrl('not a url')).toBe(false)
  })
})

describe('validateURL', () => {
  test('accepts a normal https URL', () => {
    expect(validateURL('https://example.com/path')).toBe(true)
  })

  test('accepts http (upgraded to https at fetch time)', () => {
    expect(validateURL('http://example.com')).toBe(true)
  })

  test('rejects a URL with embedded credentials', () => {
    expect(validateURL('https://user:pass@example.com')).toBe(false)
  })

  test('rejects a hostname without a dot (non-public)', () => {
    expect(validateURL('https://localhost/x')).toBe(false)
  })

  test('rejects an unparseable URL', () => {
    expect(validateURL('::::')).toBe(false)
  })

  test('rejects an over-long URL', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2001)
    expect(validateURL(longUrl)).toBe(false)
  })
})

describe('isPermittedRedirect', () => {
  test('allows adding www.', () => {
    expect(
      isPermittedRedirect('https://example.com/', 'https://www.example.com/'),
    ).toBe(true)
  })

  test('allows removing www.', () => {
    expect(
      isPermittedRedirect('https://www.example.com/', 'https://example.com/'),
    ).toBe(true)
  })

  test('allows same-host path changes', () => {
    expect(
      isPermittedRedirect('https://example.com/a', 'https://example.com/b?x=1'),
    ).toBe(true)
  })

  test('blocks a cross-host redirect', () => {
    expect(
      isPermittedRedirect('https://example.com/', 'https://evil.com/'),
    ).toBe(false)
  })

  test('blocks a protocol downgrade', () => {
    expect(
      isPermittedRedirect('https://example.com/', 'http://example.com/'),
    ).toBe(false)
  })

  test('blocks a port change', () => {
    expect(
      isPermittedRedirect(
        'https://example.com/',
        'https://example.com:8443/',
      ),
    ).toBe(false)
  })

  test('blocks a redirect that injects credentials', () => {
    expect(
      isPermittedRedirect(
        'https://example.com/',
        'https://attacker:pw@example.com/',
      ),
    ).toBe(false)
  })
})

describe('WebFetchTool registration', () => {
  test('is registered in getAllBaseTools', () => {
    expect(getAllBaseTools().some(t => t.name === WEB_FETCH_TOOL_NAME)).toBe(
      true,
    )
  })

  test('is enabled (no longer a disabled stub)', async () => {
    expect(await WebFetchTool.isEnabled()).toBe(true)
  })

  test('validateInput rejects a malformed URL', async () => {
    const result = await WebFetchTool.validateInput!({
      url: 'not a url',
      prompt: 'x',
    })
    expect(result.result).toBe(false)
  })
})
